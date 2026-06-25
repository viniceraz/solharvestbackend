const { CROP_RARITIES, ANIMAL_RARITIES, CROP_TYPES } = require('../config/constants')

// Weighted roll over a rarity table's dropRate values.
function roll(table) {
  const r = Math.random()
  let acc = 0
  for (const tier of table) {
    acc += tier.dropRate
    if (r < acc) return tier
  }
  return table[0]
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

// Roll a crop: random visual crop type + rarity-driven stats.
function rollCrop() {
  const tier = roll(CROP_RARITIES)
  return {
    cropType: pick(CROP_TYPES),
    rarity: tier.name,
    baseFarmRate: tier.farmRate,
    lifeHours: tier.lifeHours,
  }
}

// Roll an animal: species + stats are both tied to the rolled rarity tier.
function rollAnimal() {
  const tier = roll(ANIMAL_RARITIES)
  return {
    animalType: tier.animal,
    rarity: tier.name,
    baseFarmRate: tier.farmRate,
    lifeHours: tier.lifeHours,
  }
}

module.exports = { roll, rollCrop, rollAnimal }
