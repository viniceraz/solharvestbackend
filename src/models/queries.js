const { pool } = require('../config/database')
const { ITEM_TYPES } = require('../config/constants')

// Thin data-access layer. Every SQL statement lives here as a named function so
// routes/services never build SQL inline.
const q = {
  // ---- Users --------------------------------------------------------------
  async findUserByWallet(wallet) {
    const { rows } = await pool.query('SELECT * FROM users WHERE wallet_address = $1', [wallet])
    return rows[0] || null
  },
  async getUserById(id) {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id])
    return rows[0] || null
  },
  async createUser(wallet, { onchain = 0, offchain = 0, isAdmin = false }) {
    const { rows } = await pool.query(
      `INSERT INTO users (wallet_address, onchain_balance, offchain_balance, is_admin, max_plots, max_pens)
       VALUES ($1, $2, $3, $4, 6, 6) RETURNING *`,
      [wallet, onchain, offchain, isAdmin]
    )
    return rows[0]
  },
  async updateLastLogin(id) {
    await pool.query('UPDATE users SET last_login = NOW(), updated_at = NOW() WHERE id = $1', [id])
  },
  async setAdmin(id, isAdmin) {
    await pool.query('UPDATE users SET is_admin = $2 WHERE id = $1', [id, isAdmin])
  },
  // generic balance/field mutation used by bank, shop, harvest, admin
  async adjustBalances(id, { offchain = 0, onchain = 0, deposited = 0, withdrawn = 0, harvested = 0 }) {
    const { rows } = await pool.query(
      `UPDATE users SET
         offchain_balance = offchain_balance + $2,
         onchain_balance = onchain_balance + $3,
         total_deposited = total_deposited + $4,
         total_withdrawn = total_withdrawn + $5,
         total_harvested = total_harvested + $6,
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, offchain, onchain, deposited, withdrawn, harvested]
    )
    return rows[0]
  },
  // Atomic, guarded balance moves (prevent double-spend / negative balances)
  async spendOffchain(userId, cost) {
    const { rows } = await pool.query(
      'UPDATE users SET offchain_balance = offchain_balance - $2, updated_at = NOW() WHERE id = $1 AND offchain_balance >= $2 RETURNING *',
      [userId, cost]
    )
    return rows[0] || null
  },
  async creditOffchain(userId, amount, harvested = 0) {
    const { rows } = await pool.query(
      'UPDATE users SET offchain_balance = offchain_balance + $2, total_harvested = total_harvested + $3, updated_at = NOW() WHERE id = $1 RETURNING *',
      [userId, amount, harvested]
    )
    return rows[0]
  },
  async depositMove(userId, amount, received) {
    const { rows } = await pool.query(
      `UPDATE users SET onchain_balance = onchain_balance - $2, offchain_balance = offchain_balance + $3,
         total_deposited = total_deposited + $2, updated_at = NOW()
       WHERE id = $1 AND onchain_balance >= $2 RETURNING *`,
      [userId, amount, received]
    )
    return rows[0] || null
  },
  async withdrawMove(userId, amount, received) {
    const { rows } = await pool.query(
      `UPDATE users SET offchain_balance = offchain_balance - $2, onchain_balance = onchain_balance + $3,
         total_withdrawn = total_withdrawn + $2, updated_at = NOW()
       WHERE id = $1 AND offchain_balance >= $2 RETURNING *`,
      [userId, amount, received]
    )
    return rows[0] || null
  },
  async setUserField(id, field, value) {
    const allowed = ['onchain_balance', 'offchain_balance', 'max_plots', 'max_pens']
    if (!allowed.includes(field)) throw new Error('field not allowed')
    const { rows } = await pool.query(`UPDATE users SET ${field} = $2, updated_at = NOW() WHERE id = $1 RETURNING *`, [id, value])
    return rows[0]
  },
  async incUserField(id, field, delta) {
    const allowed = ['max_plots', 'max_pens']
    if (!allowed.includes(field)) throw new Error('field not allowed')
    const { rows } = await pool.query(`UPDATE users SET ${field} = ${field} + $2, updated_at = NOW() WHERE id = $1 RETURNING *`, [id, delta])
    return rows[0]
  },

  // ---- Inventory ----------------------------------------------------------
  async ensureInventory(userId, starter = {}) {
    for (const item of ITEM_TYPES) {
      await pool.query(
        `INSERT INTO inventory (user_id, item_type, quantity) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, item_type) DO NOTHING`,
        [userId, item, starter[item] || 0]
      )
    }
  },
  async getInventory(userId) {
    const { rows } = await pool.query('SELECT item_type, quantity FROM inventory WHERE user_id = $1', [userId])
    const inv = {}
    for (const item of ITEM_TYPES) inv[item] = 0
    for (const r of rows) inv[r.item_type] = r.quantity
    return inv
  },
  async getItem(userId, item) {
    const { rows } = await pool.query('SELECT quantity FROM inventory WHERE user_id = $1 AND item_type = $2', [userId, item])
    return rows[0] ? rows[0].quantity : 0
  },
  async addItem(userId, item, delta) {
    const { rows } = await pool.query(
      `INSERT INTO inventory (user_id, item_type, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, item_type) DO UPDATE SET quantity = inventory.quantity + $3
       RETURNING quantity`,
      [userId, item, delta]
    )
    return rows[0].quantity
  },
  // Atomically consume `n` of an item; returns true only if there was enough.
  // Prevents check-then-act races (e.g. rapid plant clicks double-spending a seed).
  async consumeItem(userId, item, n = 1) {
    const { rows } = await pool.query(
      `UPDATE inventory SET quantity = quantity - $3
       WHERE user_id = $1 AND item_type = $2 AND quantity >= $3 RETURNING quantity`,
      [userId, item, n]
    )
    return rows.length > 0
  },

  // ---- Promo pack ---------------------------------------------------------
  async promoRemaining() {
    const { rows } = await pool.query('SELECT remaining FROM promo_pack WHERE id = 1')
    return rows[0] ? rows[0].remaining : 0
  },
  async promoPurchased(userId) {
    const { rows } = await pool.query('SELECT 1 FROM promo_purchases WHERE user_id = $1', [userId])
    return rows.length > 0
  },
  // Buy the pack ATOMICALLY: claim a per-player slot, decrement global stock,
  // deduct HC, and grant all items — all in one transaction so nothing races,
  // oversells, or charges without delivering. Returns {error} or {remaining,balance}.
  async buyPromoPack(userId, price, contents) {
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      const claim = await c.query('INSERT INTO promo_purchases (user_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING user_id', [userId])
      if (claim.rows.length === 0) { await c.query('ROLLBACK'); return { error: 'already' } }
      const stock = await c.query('UPDATE promo_pack SET remaining = remaining - 1 WHERE id = 1 AND remaining > 0 RETURNING remaining')
      if (stock.rows.length === 0) { await c.query('ROLLBACK'); return { error: 'soldout' } }
      const spend = await c.query('UPDATE users SET offchain_balance = offchain_balance - $2 WHERE id = $1 AND offchain_balance >= $2 RETURNING offchain_balance', [userId, price])
      if (spend.rows.length === 0) { await c.query('ROLLBACK'); return { error: 'funds' } }
      for (const [item, qty] of Object.entries(contents)) {
        await c.query(
          `INSERT INTO inventory (user_id, item_type, quantity) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, item_type) DO UPDATE SET quantity = inventory.quantity + $3`,
          [userId, item, qty]
        )
      }
      await c.query('COMMIT')
      return { remaining: stock.rows[0].remaining, balance: spend.rows[0].offchain_balance }
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      c.release()
    }
  },

  // ---- Scarecrow ----------------------------------------------------------
  async ensureScarecrow(userId) {
    await pool.query('INSERT INTO scarecrow_status (user_id, active) VALUES ($1, FALSE) ON CONFLICT (user_id) DO NOTHING', [userId])
  },
  async getScarecrow(userId) {
    const { rows } = await pool.query('SELECT active, expires_at FROM scarecrow_status WHERE user_id = $1', [userId])
    return rows[0] || { active: false, expires_at: null }
  },
  async setScarecrow(userId, active, expiresAt) {
    await pool.query(
      `INSERT INTO scarecrow_status (user_id, active, expires_at) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET active = $2, expires_at = $3`,
      [userId, active, expiresAt]
    )
  },

  // ---- World --------------------------------------------------------------
  async getWorld() {
    const { rows } = await pool.query('SELECT * FROM world_state ORDER BY id LIMIT 1')
    return rows[0]
  },
  async setWorldSeason(season) {
    await pool.query('UPDATE world_state SET season = $1, season_started_at = NOW() WHERE id = (SELECT id FROM world_state ORDER BY id LIMIT 1)', [season])
  },
  async setWorldWeather(weather) {
    await pool.query('UPDATE world_state SET weather = $1, weather_changed_at = NOW() WHERE id = (SELECT id FROM world_state ORDER BY id LIMIT 1)', [weather])
  },
  async setLoopPaused(paused) {
    await pool.query('UPDATE world_state SET loop_paused = $1 WHERE id = (SELECT id FROM world_state ORDER BY id LIMIT 1)', [paused])
  },
  async setGlobalMultiplier(m) {
    await pool.query('UPDATE world_state SET global_multiplier = $1 WHERE id = (SELECT id FROM world_state ORDER BY id LIMIT 1)', [m])
  },

  // ---- Plants -------------------------------------------------------------
  async getPlants(userId) {
    const { rows } = await pool.query('SELECT * FROM plants WHERE user_id = $1 ORDER BY plot_index', [userId])
    return rows
  },
  async getPlant(userId, plotIndex) {
    const { rows } = await pool.query('SELECT * FROM plants WHERE user_id = $1 AND plot_index = $2', [userId, plotIndex])
    return rows[0] || null
  },
  async createPlant(p) {
    const { rows } = await pool.query(
      `INSERT INTO plants (user_id, plot_index, crop_type, rarity, base_farm_rate, life_hours)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [p.userId, p.plotIndex, p.cropType, p.rarity, p.baseFarmRate, p.lifeHours]
    )
    return rows[0]
  },
  async removePlant(userId, plotIndex) {
    await pool.query('DELETE FROM plants WHERE user_id = $1 AND plot_index = $2', [userId, plotIndex])
  },
  async waterPlant(userId, plotIndex) {
    const { rows } = await pool.query(
      'UPDATE plants SET last_watered = NOW(), needs_water = FALSE, has_pest = FALSE WHERE user_id=$1 AND plot_index=$2 RETURNING *',
      [userId, plotIndex]
    )
    return rows[0]
  },
  async fertilizePlant(userId, plotIndex, until) {
    const { rows } = await pool.query('UPDATE plants SET fertilizer_until = $3 WHERE user_id=$1 AND plot_index=$2 RETURNING *', [userId, plotIndex, until])
    return rows[0]
  },
  async clearPlantFarmed(userId, plotIndex) {
    const { rows } = await pool.query('UPDATE plants SET total_farmed = 0, last_farm_tick = NOW() WHERE user_id=$1 AND plot_index=$2 RETURNING *', [userId, plotIndex])
    return rows[0]
  },
  // Remove pests from all of a user's living plants (used by the scarecrow).
  async clearPests(userId) {
    const { rows } = await pool.query('UPDATE plants SET has_pest = FALSE WHERE user_id=$1 AND is_dead = FALSE AND has_pest = TRUE RETURNING plot_index', [userId])
    return rows.length
  },

  // ---- Animals ------------------------------------------------------------
  async getAnimals(userId) {
    const { rows } = await pool.query('SELECT * FROM animals WHERE user_id = $1 ORDER BY pen_index', [userId])
    return rows
  },
  async getAnimal(userId, penIndex) {
    const { rows } = await pool.query('SELECT * FROM animals WHERE user_id = $1 AND pen_index = $2', [userId, penIndex])
    return rows[0] || null
  },
  async createAnimal(a) {
    const { rows } = await pool.query(
      `INSERT INTO animals (user_id, pen_index, animal_type, rarity, base_farm_rate, life_hours)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [a.userId, a.penIndex, a.animalType, a.rarity, a.baseFarmRate, a.lifeHours]
    )
    return rows[0]
  },
  async removeAnimal(userId, penIndex) {
    await pool.query('DELETE FROM animals WHERE user_id = $1 AND pen_index = $2', [userId, penIndex])
  },
  async feedAnimal(userId, penIndex) {
    const { rows } = await pool.query('UPDATE animals SET last_fed = NOW(), needs_food = FALSE WHERE user_id=$1 AND pen_index=$2 RETURNING *', [userId, penIndex])
    return rows[0]
  },
  async healAnimal(userId, penIndex) {
    const { rows } = await pool.query('UPDATE animals SET is_sick = FALSE WHERE user_id=$1 AND pen_index=$2 RETURNING *', [userId, penIndex])
    return rows[0]
  },
  async clearAnimalProduced(userId, penIndex) {
    const { rows } = await pool.query('UPDATE animals SET total_produced = 0, last_farm_tick = NOW() WHERE user_id=$1 AND pen_index=$2 RETURNING *', [userId, penIndex])
    return rows[0]
  },

  // ---- Transactions / notifications --------------------------------------
  async logTx(userId, type, amount, taxAmount = 0, detail = null) {
    await pool.query(
      'INSERT INTO transactions (user_id, type, amount, tax_amount, item_detail) VALUES ($1,$2,$3,$4,$5)',
      [userId, type, amount, taxAmount, detail]
    )
  },
  async getTransactions(userId, limit = 50, offset = 0) {
    const { rows } = await pool.query('SELECT * FROM transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [userId, limit, offset])
    return rows
  },
  async addNotification(userId, message, type = 'info') {
    await pool.query('INSERT INTO notifications (user_id, message, type) VALUES ($1,$2,$3)', [userId, message, type])
  },
  async getNotifications(userId, limit = 50) {
    const { rows } = await pool.query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2', [userId, limit])
    return rows
  },
  async markNotificationsRead(userId) {
    await pool.query('UPDATE notifications SET read = TRUE WHERE user_id=$1 AND read = FALSE', [userId])
  },

  // ---- Game loop (global, set-based) -------------------------------------
  // Accrue earnings for every non-blocked plant in one statement.
  // envMult = season * weather * global_multiplier (fertilizer 2x applied here).
  async accruePlants(envMult) {
    const r = await pool.query(
      `UPDATE plants SET
         total_farmed = total_farmed + base_farm_rate * $1
           * (CASE WHEN fertilizer_until IS NOT NULL AND fertilizer_until > NOW() THEN 2 ELSE 1 END)
           * (EXTRACT(EPOCH FROM (NOW() - last_farm_tick)) / 3600.0),
         last_farm_tick = NOW()
       WHERE is_dead = FALSE AND needs_water = FALSE AND has_pest = FALSE`,
      [envMult]
    )
    return r.rowCount
  },
  async accrueAnimals(envMult) {
    const r = await pool.query(
      `UPDATE animals SET
         total_produced = total_produced + base_farm_rate * $1
           * (EXTRACT(EPOCH FROM (NOW() - last_farm_tick)) / 3600.0),
         last_farm_tick = NOW()
       WHERE is_dead = FALSE AND needs_food = FALSE AND is_sick = FALSE`,
      [envMult]
    )
    return r.rowCount
  },
  async markThirstyPlants(intervalHours) {
    const { rows } = await pool.query(
      `UPDATE plants SET needs_water = TRUE
       WHERE is_dead = FALSE AND needs_water = FALSE AND last_watered < NOW() - ($1 * INTERVAL '1 hour')
       RETURNING user_id, crop_type, plot_index`,
      [intervalHours]
    )
    return rows
  },
  async markHungryAnimals(intervalHours) {
    const { rows } = await pool.query(
      `UPDATE animals SET needs_food = TRUE
       WHERE is_dead = FALSE AND needs_food = FALSE AND last_fed < NOW() - ($1 * INTERVAL '1 hour')
       RETURNING user_id, animal_type, pen_index`,
      [intervalHours]
    )
    return rows
  },
  async killExpiredPlants() {
    const { rows } = await pool.query(
      `UPDATE plants SET is_dead = TRUE, needs_water = FALSE
       WHERE is_dead = FALSE AND planted_at < NOW() - (life_hours * INTERVAL '1 hour')
       RETURNING user_id, crop_type, plot_index`
    )
    return rows
  },
  async killExpiredAnimals() {
    const { rows } = await pool.query(
      `UPDATE animals SET is_dead = TRUE
       WHERE is_dead = FALSE AND born_at < NOW() - (life_hours * INTERVAL '1 hour')
       RETURNING user_id, animal_type, pen_index`
    )
    return rows
  },
  async expireFertilizer() {
    await pool.query('UPDATE plants SET fertilizer_until = NULL WHERE fertilizer_until IS NOT NULL AND fertilizer_until <= NOW()')
  },
  async expireScarecrows() {
    const { rows } = await pool.query('UPDATE scarecrow_status SET active = FALSE WHERE active = TRUE AND expires_at <= NOW() RETURNING user_id')
    return rows
  },
  async rollPests(chance) {
    const { rows } = await pool.query(
      `UPDATE plants SET has_pest = TRUE
       WHERE is_dead = FALSE AND has_pest = FALSE AND needs_water = FALSE
         AND user_id NOT IN (SELECT user_id FROM scarecrow_status WHERE active = TRUE AND expires_at > NOW())
         AND random() < $1
       RETURNING user_id, crop_type, plot_index`,
      [chance]
    )
    return rows
  },
  async rollDiseases(chance) {
    const { rows } = await pool.query(
      `UPDATE animals SET is_sick = TRUE
       WHERE is_dead = FALSE AND is_sick = FALSE AND random() < $1
       RETURNING user_id, animal_type, pen_index`,
      [chance]
    )
    return rows
  },
  async notifyAll(message, type = 'info') {
    await pool.query('INSERT INTO notifications (user_id, message, type) SELECT id, $1, $2 FROM users', [message, type])
  },

  // ---- Bans ---------------------------------------------------------------
  async isBanned(userId) {
    const { rows } = await pool.query('SELECT 1 FROM banned_players WHERE user_id = $1', [userId])
    return rows.length > 0
  },
  async banPlayer(userId, reason, adminWallet) {
    await pool.query(
      `INSERT INTO banned_players (user_id, reason, banned_by) VALUES ($1,$2,$3)
       ON CONFLICT (user_id) DO UPDATE SET reason = $2, banned_by = $3, banned_at = NOW()`,
      [userId, reason || null, adminWallet]
    )
  },
  async unbanPlayer(userId) {
    await pool.query('DELETE FROM banned_players WHERE user_id = $1', [userId])
  },

  // ---- Referrals ----------------------------------------------------------
  // Bind a referrer ONCE (never overwrite) and never to self.
  async setReferrerOnce(userId, referrerId) {
    const { rows } = await pool.query(
      'UPDATE users SET referred_by = $2, updated_at = NOW() WHERE id = $1 AND referred_by IS NULL AND id <> $2 RETURNING id',
      [userId, referrerId]
    )
    return rows.length > 0
  },
  // Pay a referral reward atomically, at most once per referee (PK on referee_id).
  // Returns true if this call actually paid (false if already rewarded).
  async payReferralReward(refereeId, referrerId, signature, amountHc) {
    const ins = await pool.query(
      `INSERT INTO referral_rewards (referee_id, referrer_id, deposit_signature, amount_hc)
       VALUES ($1, $2, $3, $4) ON CONFLICT (referee_id) DO NOTHING`,
      [refereeId, referrerId, signature, amountHc]
    )
    if (!ins.rowCount) return false
    await pool.query(
      `UPDATE users SET offchain_balance = offchain_balance + $2,
         referral_earnings = referral_earnings + $2, updated_at = NOW() WHERE id = $1`,
      [referrerId, amountHc]
    )
    return true
  },
  async getReferralStats(userId) {
    const { rows } = await pool.query(
      `SELECT COALESCE(referral_earnings, 0) AS earnings,
         (SELECT COUNT(*)::int FROM users WHERE referred_by = $1) AS referrals,
         (SELECT COUNT(*)::int FROM referral_rewards WHERE referrer_id = $1) AS rewarded
       FROM users WHERE id = $1`,
      [userId]
    )
    const r = rows[0] || {}
    return { earnings: Number(r.earnings) || 0, referrals: r.referrals || 0, rewarded: r.rewarded || 0 }
  },

  // ---- Pool-wallet deposits / withdrawals ---------------------------------
  // Atomically record a deposit by its tx signature. Returns TRUE only the first
  // time (tx_signature is UNIQUE) — the caller credits HC only when true.
  async recordDepositTx(signature, userId, hcAmount, taxAmount, detail) {
    const { rowCount } = await pool.query(
      `INSERT INTO transactions (user_id, type, amount, tax_amount, item_detail, tx_signature)
       VALUES ($1, 'deposit', $2, $3, $4, $5) ON CONFLICT (tx_signature) DO NOTHING`,
      [userId, hcAmount, taxAmount, detail, signature]
    )
    return rowCount > 0
  },
  async logWithdrawTx(userId, hcAmount, taxAmount, detail, signature) {
    await pool.query(
      `INSERT INTO transactions (user_id, type, amount, tax_amount, item_detail, tx_signature)
       VALUES ($1, 'withdraw', $2, $3, $4, $5)`,
      [userId, hcAmount, taxAmount, detail, signature]
    )
  },
  async withdrawDailyTotalHc(userId) {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
       WHERE user_id = $1 AND type = 'withdraw' AND created_at > NOW() - INTERVAL '24 hours'`, [userId])
    return Number(rows[0].total)
  },
  async withdrawCountLastHour(userId) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM transactions
       WHERE user_id = $1 AND type = 'withdraw' AND created_at > NOW() - INTERVAL '1 hour'`, [userId])
    return rows[0].c
  },

  // ---- On-chain deposits (idempotency) ------------------------------------
  async isDepositProcessed(signature) {
    const { rows } = await pool.query('SELECT 1 FROM processed_deposits WHERE signature = $1', [signature])
    return rows.length > 0
  },
  async recordDeposit(signature, userId, tokenAmount, hcCredited) {
    await pool.query(
      `INSERT INTO processed_deposits (signature, user_id, token_amount, hc_credited)
       VALUES ($1, $2, $3, $4) ON CONFLICT (signature) DO NOTHING`,
      [signature, userId, String(tokenAmount), hcCredited]
    )
  },

  // ---- Public stats -------------------------------------------------------
  async playerCount() {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM users')
    return rows[0].c
  },

  // ---- Admin: stats & lists ----------------------------------------------
  async adminOverview() {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM users) AS total_players,
        (SELECT COUNT(*)::int FROM users WHERE last_login > NOW() - INTERVAL '1 day') AS active_today,
        (SELECT COUNT(*)::int FROM users WHERE created_at > NOW() - INTERVAL '1 day') AS new_today,
        (SELECT COUNT(*)::int FROM users WHERE created_at > NOW() - INTERVAL '7 days') AS new_week,
        (SELECT COALESCE(SUM(offchain_balance),0) FROM users) AS circulating_hc,
        (SELECT COALESCE(SUM(total_deposited),0) FROM users) AS total_deposited,
        (SELECT COALESCE(SUM(total_withdrawn),0) FROM users) AS total_withdrawn,
        (SELECT COALESCE(SUM(tax_amount),0) FROM transactions) AS tax_collected,
        (SELECT COUNT(*)::int FROM plants WHERE is_dead = FALSE) AS active_plants,
        (SELECT COUNT(*)::int FROM animals WHERE is_dead = FALSE) AS active_animals,
        (SELECT COALESCE(AVG(offchain_balance),0) FROM users) AS avg_balance,
        (SELECT COALESCE(SUM(base_farm_rate),0) FROM plants WHERE is_dead=FALSE AND needs_water=FALSE AND has_pest=FALSE) AS plant_rate_base,
        (SELECT COALESCE(SUM(base_farm_rate),0) FROM animals WHERE is_dead=FALSE AND needs_food=FALSE AND is_sick=FALSE) AS animal_rate_base
    `)
    return rows[0]
  },
  async listPlayers({ limit = 50, offset = 0, search = '', sort = 'created_at', dir = 'desc' } = {}) {
    const sortable = { created_at: 'created_at', last_login: 'last_login', offchain_balance: 'offchain_balance', onchain_balance: 'onchain_balance', total_deposited: 'total_deposited' }
    const col = sortable[sort] || 'created_at'
    const d = dir === 'asc' ? 'ASC' : 'DESC'
    const params = []
    let where = ''
    if (search) {
      params.push(`%${search}%`)
      where = `WHERE wallet_address ILIKE $${params.length}`
    }
    const totalRes = await pool.query(`SELECT COUNT(*)::int AS c FROM users ${where}`, params)
    params.push(limit, offset)
    const { rows } = await pool.query(
      `SELECT u.*, b.user_id IS NOT NULL AS is_banned,
         (SELECT COUNT(*)::int FROM plants WHERE user_id = u.id AND is_dead=FALSE) AS plants,
         (SELECT COUNT(*)::int FROM animals WHERE user_id = u.id AND is_dead=FALSE) AS animals
       FROM users u LEFT JOIN banned_players b ON b.user_id = u.id
       ${where} ORDER BY ${col} ${d} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    return { total: totalRes.rows[0].c, rows }
  },
  async economyMetrics() {
    const { rows } = await pool.query(`
      SELECT date_trunc('day', created_at) AS day,
        COALESCE(SUM(CASE WHEN type='deposit' THEN amount ELSE 0 END),0) AS deposits,
        COALESCE(SUM(CASE WHEN type='withdraw' THEN amount ELSE 0 END),0) AS withdrawals,
        COALESCE(SUM(tax_amount),0) AS tax
      FROM transactions WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY day ORDER BY day`)
    return rows
  },
  async poolHistory(limit = 90) {
    const { rows } = await pool.query('SELECT * FROM pool_snapshots ORDER BY captured_at DESC LIMIT $1', [limit])
    return rows.reverse()
  },
  async snapshotPool() {
    await pool.query(`
      INSERT INTO pool_snapshots (pool_size, total_deposited, total_withdrawn)
      SELECT COALESCE(SUM(total_deposited),0) - COALESCE(SUM(total_withdrawn),0),
             COALESCE(SUM(total_deposited),0), COALESCE(SUM(total_withdrawn),0)
      FROM users`)
  },
  async shopAnalytics() {
    const { rows } = await pool.query(`
      SELECT item_detail, COUNT(*)::int AS count, COALESCE(SUM(amount),0) AS revenue
      FROM transactions WHERE type='purchase'
      GROUP BY item_detail ORDER BY count DESC LIMIT 50`)
    return rows
  },
  async filterTransactions({ type, wallet, limit = 50, offset = 0 } = {}) {
    const params = []
    const conds = []
    if (type) { params.push(type); conds.push(`t.type = $${params.length}`) }
    if (wallet) { params.push(`%${wallet}%`); conds.push(`u.wallet_address ILIKE $${params.length}`) }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
    params.push(limit, offset)
    const { rows } = await pool.query(
      `SELECT t.*, u.wallet_address FROM transactions t JOIN users u ON u.id = t.user_id
       ${where} ORDER BY t.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    return rows
  },

  // ---- Admin: config / announcements / events ----------------------------
  async getConfig() {
    const { rows } = await pool.query('SELECT * FROM game_config ORDER BY key')
    return rows
  },
  async setConfig(key, value, adminWallet) {
    await pool.query(
      `INSERT INTO game_config (key, value, updated_by) VALUES ($1,$2,$3)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW(), updated_by = $3`,
      [key, String(value), adminWallet]
    )
  },
  async listAnnouncements() {
    const { rows } = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC')
    return rows
  },
  async activeAnnouncements() {
    const { rows } = await pool.query('SELECT * FROM announcements WHERE starts_at <= NOW() AND (ends_at IS NULL OR ends_at > NOW()) ORDER BY created_at DESC')
    return rows
  },
  async createAnnouncement(a) {
    const { rows } = await pool.query(
      `INSERT INTO announcements (title, message, type, starts_at, ends_at, created_by)
       VALUES ($1,$2,$3,COALESCE($4,NOW()),$5,$6) RETURNING *`,
      [a.title, a.message, a.type || 'info', a.starts_at || null, a.ends_at || null, a.createdBy]
    )
    return rows[0]
  },
  async deleteAnnouncement(id) {
    await pool.query('DELETE FROM announcements WHERE id = $1', [id])
  },
  async createGlobalEvent(e) {
    const { rows } = await pool.query(
      `INSERT INTO global_events (name, multiplier, tax_override_deposit, tax_override_withdraw, starts_at, ends_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [e.name, e.multiplier || 1, e.tax_override_deposit || null, e.tax_override_withdraw || null, e.starts_at, e.ends_at, e.createdBy]
    )
    return rows[0]
  },
  async adminLog(adminWallet, action, targetUserId, details) {
    await pool.query('INSERT INTO admin_logs (admin_wallet, action, target_user_id, details) VALUES ($1,$2,$3,$4)', [adminWallet, action, targetUserId || null, details ? JSON.stringify(details) : null])
  },
}

module.exports = q
