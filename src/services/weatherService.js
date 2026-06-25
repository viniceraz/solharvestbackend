const { WEATHER, SEASON_ORDER } = require('../config/constants')

// Weighted weather roll: sunny 60 / rain 25 / snow 10 / wind 5.
function rollWeather() {
  const r = Math.random()
  let acc = 0
  for (const [name, cfg] of Object.entries(WEATHER)) {
    acc += cfg.chance
    if (r < acc) return name
  }
  return 'sunny'
}

const nextSeason = (season) => SEASON_ORDER[(SEASON_ORDER.indexOf(season) + 1) % SEASON_ORDER.length]

module.exports = { rollWeather, nextSeason }
