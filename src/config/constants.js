// =============================================================================
// constants.js — authoritative game economy. The server is the source of truth;
// the frontend only displays these. Mirrors the client constants exactly.
// =============================================================================
module.exports = {
  // Taxes
  DEPOSIT_TAX: 0.05,
  WITHDRAW_TAX: 0.1,

  // Fixed conversion: 1,000 $HARVEST tokens == 1 HarvestCoin. Override via env.
  // Deposit: tokens / RATE → HC (−5% tax). Withdraw: HC * RATE → tokens (−10% tax).
  TOKEN_TO_HC_RATE: parseInt(process.env.TOKEN_TO_HC_RATE || '1000', 10),

  // Referral: referrer earns this fraction of a referee's FIRST deposit (in HC,
  // protocol-funded). Referrer must have deposited at least once to be eligible.
  REFERRAL_RATE: parseFloat(process.env.REFERRAL_RATE || '0.05'),

  // Pool-wallet limits / anti-abuse (env-overridable)
  MIN_DEPOSIT_TOKENS: parseInt(process.env.MIN_DEPOSIT_TOKENS || '1000', 10),
  MIN_WITHDRAW_HC: parseFloat(process.env.MIN_WITHDRAW_HC || '10'),
  MAX_WITHDRAW_PER_DAY_HC: parseFloat(process.env.MAX_WITHDRAW_PER_DAY_HC || '10000'),
  MAX_WITHDRAWS_PER_HOUR: parseInt(process.env.MAX_WITHDRAWS_PER_HOUR || '3', 10),

  // Shop prices (in HC)
  PRICES: {
    seed: 50,
    egg: 80,
    water: 2, // gives 5 uses
    feed: 3, // gives 5 uses
    scarecrow: 10,
    fertilizer: 12,
    medicine: 10,
    plot: 20,
    pen: 20,
  },

  // Bulk amounts (uses per purchase)
  BULK: { water: 5, feed: 5 },

  // Crop rarities
  CROP_RARITIES: [
    { name: 'Common', dropRate: 0.4, farmRate: 0.9, lifeHours: 72, color: '#8B9DAF' },
    { name: 'Uncommon', dropRate: 0.25, farmRate: 0.65, lifeHours: 120, color: '#4CAF50' },
    { name: 'Rare', dropRate: 0.15, farmRate: 0.7, lifeHours: 168, color: '#2196F3' },
    { name: 'Epic', dropRate: 0.1, farmRate: 1.2, lifeHours: 240, color: '#9C27B0' },
    { name: 'Legendary', dropRate: 0.05, farmRate: 2.5, lifeHours: 360, color: '#FF9800' },
    { name: 'Mythic', dropRate: 0.03, farmRate: 5.0, lifeHours: 504, color: '#F44336' },
    { name: 'Celestial', dropRate: 0.02, farmRate: 10.0, lifeHours: 720, color: '#00E5FF' },
  ],

  // Animal rarities
  ANIMAL_RARITIES: [
    { name: 'Common', animal: 'mouse', dropRate: 0.4, farmRate: 1.1, lifeHours: 96 },
    { name: 'Uncommon', animal: 'bunny', dropRate: 0.25, farmRate: 0.85, lifeHours: 144 },
    { name: 'Rare', animal: 'bird', dropRate: 0.15, farmRate: 0.9, lifeHours: 192 },
    { name: 'Epic', animal: 'cat', dropRate: 0.1, farmRate: 1.5, lifeHours: 288 },
    { name: 'Legendary', animal: 'fox', dropRate: 0.05, farmRate: 3.0, lifeHours: 432 },
    { name: 'Mythic', animal: 'pig', dropRate: 0.03, farmRate: 6.0, lifeHours: 600 },
    { name: 'Celestial', animal: 'cow', dropRate: 0.02, farmRate: 12.0, lifeHours: 840 },
  ],

  // Crop types (19 from the asset pack)
  CROP_TYPES: [
    'bamboo', 'beetroot', 'berry', 'broccoli', 'carrot', 'cauliflower',
    'celery', 'corn', 'eggplant', 'grape', 'leek', 'lettuce', 'onion',
    'pepper', 'potato', 'pumpkin', 'radish', 'tomato', 'wheat',
  ],

  // Seasons
  // Seasons rotate together with the weather every WEATHER_CHANGE_HOURS (2h).
  SEASONS: {
    spring: { modifier: 1.1, duration_hours: 2 },
    summer: { modifier: 1.2, duration_hours: 2 },
    autumn: { modifier: 1.0, duration_hours: 2 },
    winter: { modifier: 0.8, duration_hours: 2 },
  },
  SEASON_ORDER: ['spring', 'summer', 'autumn', 'winter'],

  // Weather
  WEATHER: {
    sunny: { modifier: 1.0, chance: 0.6 },
    rain: { modifier: 1.15, chance: 0.25 },
    snow: { modifier: 0.75, chance: 0.1 },
    wind: { modifier: 1.0, chance: 0.05 },
  },
  WEATHER_CHANGE_HOURS: 2,

  // Timers
  WATER_INTERVAL_HOURS: 24,
  FEED_INTERVAL_HOURS: 24,
  SCARECROW_DURATION_HOURS: 12,
  FERTILIZER_DURATION_HOURS: 6,
  PEST_CHANCE_PER_HOUR: 0.15,
  DISEASE_CHANCE_PER_HOUR: 0.1,

  // Limits
  MAX_PLOTS_LIMIT: 24,
  MAX_PENS_LIMIT: 24,

  // New wallets start completely empty — no balances, no items, no plants/animals.
  // Players acquire HC by depositing real $HARVEST on-chain, then buy items in the
  // shop. (onchain_balance is the legacy simulated field; the HUD reads the real
  // on-chain wallet balance.)
  STARTER: {
    onchain_balance: 0,
    offchain_balance: 0,
    inventory: {},
  },

  ITEM_TYPES: ['seed', 'egg', 'water', 'feed', 'scarecrow', 'fertilizer', 'medicine'],
}
