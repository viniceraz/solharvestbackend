-- SolHarvest initial schema (idempotent: safe to re-run)

-- Users (wallet-based auth)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(44) UNIQUE NOT NULL,
  onchain_balance DECIMAL(20,4) DEFAULT 0,
  offchain_balance DECIMAL(20,4) DEFAULT 0,
  total_deposited DECIMAL(20,4) DEFAULT 0,
  total_withdrawn DECIMAL(20,4) DEFAULT 0,
  total_harvested DECIMAL(20,4) DEFAULT 0,
  max_plots INT DEFAULT 6,
  max_pens INT DEFAULT 4,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_login TIMESTAMP DEFAULT NOW()
);

-- Inventory
CREATE TABLE IF NOT EXISTS inventory (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  item_type VARCHAR(20) NOT NULL,
  quantity INT DEFAULT 0,
  UNIQUE(user_id, item_type)
);

-- Plants (active crops)
CREATE TABLE IF NOT EXISTS plants (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  plot_index INT NOT NULL,
  crop_type VARCHAR(30) NOT NULL,
  rarity VARCHAR(20) NOT NULL,
  base_farm_rate DECIMAL(10,4) NOT NULL,
  life_hours INT NOT NULL,
  total_farmed DECIMAL(20,4) DEFAULT 0,
  planted_at TIMESTAMP DEFAULT NOW(),
  last_watered TIMESTAMP DEFAULT NOW(),
  last_farm_tick TIMESTAMP DEFAULT NOW(),
  needs_water BOOLEAN DEFAULT FALSE,
  has_pest BOOLEAN DEFAULT FALSE,
  fertilizer_until TIMESTAMP DEFAULT NULL,
  is_dead BOOLEAN DEFAULT FALSE,
  UNIQUE(user_id, plot_index)
);

-- Animals (active animals)
CREATE TABLE IF NOT EXISTS animals (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  pen_index INT NOT NULL,
  animal_type VARCHAR(20) NOT NULL,
  rarity VARCHAR(20) NOT NULL,
  base_farm_rate DECIMAL(10,4) NOT NULL,
  life_hours INT NOT NULL,
  total_produced DECIMAL(20,4) DEFAULT 0,
  born_at TIMESTAMP DEFAULT NOW(),
  last_fed TIMESTAMP DEFAULT NOW(),
  last_farm_tick TIMESTAMP DEFAULT NOW(),
  needs_food BOOLEAN DEFAULT FALSE,
  is_sick BOOLEAN DEFAULT FALSE,
  is_dead BOOLEAN DEFAULT FALSE,
  UNIQUE(user_id, pen_index)
);

-- Scarecrow status (per user)
CREATE TABLE IF NOT EXISTS scarecrow_status (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  active BOOLEAN DEFAULT FALSE,
  expires_at TIMESTAMP DEFAULT NULL
);

-- World state (global)
CREATE TABLE IF NOT EXISTS world_state (
  id SERIAL PRIMARY KEY,
  season VARCHAR(10) DEFAULT 'spring',
  season_started_at TIMESTAMP DEFAULT NOW(),
  weather VARCHAR(10) DEFAULT 'sunny',
  weather_changed_at TIMESTAMP DEFAULT NOW(),
  loop_paused BOOLEAN DEFAULT FALSE,
  global_multiplier DECIMAL(4,2) DEFAULT 1.00
);

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL,
  amount DECIMAL(20,4) NOT NULL,
  tax_amount DECIMAL(20,4) DEFAULT 0,
  item_detail VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  message VARCHAR(255) NOT NULL,
  type VARCHAR(20) DEFAULT 'info',
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Admin: runtime-editable config overrides
CREATE TABLE IF NOT EXISTS game_config (
  key VARCHAR(50) PRIMARY KEY,
  value VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by VARCHAR(44)
);

-- Admin: action audit log
CREATE TABLE IF NOT EXISTS admin_logs (
  id SERIAL PRIMARY KEY,
  admin_wallet VARCHAR(44) NOT NULL,
  action VARCHAR(50) NOT NULL,
  target_user_id INT,
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Announcements
CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  title VARCHAR(100) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(20) DEFAULT 'info',
  starts_at TIMESTAMP DEFAULT NOW(),
  ends_at TIMESTAMP,
  created_by VARCHAR(44) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Global events (double-farm weekends, tax holidays, etc.)
CREATE TABLE IF NOT EXISTS global_events (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  multiplier DECIMAL(4,2) DEFAULT 1.00,
  tax_override_deposit DECIMAL(4,2),
  tax_override_withdraw DECIMAL(4,2),
  starts_at TIMESTAMP NOT NULL,
  ends_at TIMESTAMP NOT NULL,
  created_by VARCHAR(44) NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Banned players
CREATE TABLE IF NOT EXISTS banned_players (
  user_id INT REFERENCES users(id) ON DELETE CASCADE PRIMARY KEY,
  reason VARCHAR(255),
  banned_by VARCHAR(44) NOT NULL,
  banned_at TIMESTAMP DEFAULT NOW()
);

-- Pool history snapshots (for admin charts)
CREATE TABLE IF NOT EXISTS pool_snapshots (
  id SERIAL PRIMARY KEY,
  pool_size DECIMAL(20,4) NOT NULL,
  total_deposited DECIMAL(20,4) NOT NULL,
  total_withdrawn DECIMAL(20,4) NOT NULL,
  captured_at TIMESTAMP DEFAULT NOW()
);

-- On-chain deposit signatures already credited as HC (idempotency / no double-credit)
CREATE TABLE IF NOT EXISTS processed_deposits (
  signature VARCHAR(128) PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  token_amount BIGINT NOT NULL,
  hc_credited DECIMAL(20,4) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Referrals: who referred each user (set once at signup), + lifetime earnings (HC)
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INT REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_earnings DECIMAL(20,4) DEFAULT 0;

-- Exactly ONE referral reward per referred user, ever (first-deposit-only, idempotent).
CREATE TABLE IF NOT EXISTS referral_rewards (
  referee_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  referrer_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deposit_signature VARCHAR(128) NOT NULL,
  amount_hc DECIMAL(20,4) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Pool-wallet deposits/withdrawals: on-chain tx signature (UNIQUE → no double-credit).
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tx_signature VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_signature ON transactions(tx_signature);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_referral_referrer ON referral_rewards(referrer_id);
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);
CREATE INDEX IF NOT EXISTS idx_plants_user ON plants(user_id);
CREATE INDEX IF NOT EXISTS idx_animals_user ON animals(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_admin_logs_date ON admin_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_global_events_active ON global_events(starts_at, ends_at, active);

-- Seed the single world_state row
INSERT INTO world_state (season, weather)
SELECT 'spring', 'sunny'
WHERE NOT EXISTS (SELECT 1 FROM world_state);

-- Limited promo "Full Farmer Pack": one global stock counter + a per-player guard.
CREATE TABLE IF NOT EXISTS promo_pack (
  id INT PRIMARY KEY,
  remaining INT NOT NULL
);
INSERT INTO promo_pack (id, remaining)
SELECT 1, 40 WHERE NOT EXISTS (SELECT 1 FROM promo_pack WHERE id = 1);

CREATE TABLE IF NOT EXISTS promo_purchases (
  user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Spin the Wheel history (for player history + admin stats).
CREATE TABLE IF NOT EXISTS spin_history (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  prize INT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_spin_user ON spin_history(user_id);
CREATE INDEX IF NOT EXISTS idx_spin_date ON spin_history(created_at);
