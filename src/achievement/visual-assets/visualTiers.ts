import { firstBatchAchievementIds } from './firstBatch'
import { secondBatchAchievementIds } from './secondBatch'
import { thirdBatchAchievementIds } from './thirdBatch'
import { finalBatchAchievementIds } from './finalBatch'

/** The four Song museum tiers are ART CURATION, not the award engine's rarity.
 * The production rarity and P0/P1/P2 award conditions stay in achievements.json.
 * The first 20 generated images contain a blank cartouche; later 14 do not.
 */
export const songVisualGroups = [
  { key:'ink', label:'素笺墨印', tab:'素笺', hasPaintedPlaque:true, ids:firstBatchAchievementIds },
  { key:'celadon', label:'汝窑天青', tab:'汝窑', hasPaintedPlaque:true, ids:secondBatchAchievementIds },
  { key:'cinnabar', label:'泥金朱砂', tab:'泥金', hasPaintedPlaque:false, ids:thirdBatchAchievementIds },
  { key:'hidden', label:'云中秘藏', tab:'秘藏', hasPaintedPlaque:false, ids:finalBatchAchievementIds },
] as const

export type SongVisualTier = (typeof songVisualGroups)[number]['key']
const groupById = new Map<string, (typeof songVisualGroups)[number]>()
songVisualGroups.forEach(group => {
  group.ids.forEach(id => {
    if (groupById.has(id)) throw new Error('Duplicate Song visual artwork group: '+id)
    groupById.set(id, group)
  })
})
export function getSongVisualGroup(id: string) {
  const group = groupById.get(id)
  if (!group) throw new Error('Achievement lacks Song visual tier: '+id)
  return group
}
export const songVisualRank = (id: string) =>
  songVisualGroups.findIndex(group => group.key === getSongVisualGroup(id).key)
