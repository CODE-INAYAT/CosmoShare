export const roomNumbers: string[] = [
    "203",
    "204",
    "205",
    "214",
    "215",
    "220",
    "221",
    "222",
    "223",
    "304",
    "305",
    "306",
    "307",
    "308",
    "309",
    "310",
    "312",
    "317",
]

// Pre-compute a Set for O(1) time complexity lookups
export const validRoomsSet = new Set<string>(roomNumbers)


/**
 * Room display names (optional)
 * Uncomment and use if want custom labels for rooms
 */
// export const roomLabels: Record<string, string> = {
//   "300": "Computer Lab A",
//   "301": "Computer Lab B",
//   "302": "Computer Lab C",
// }
