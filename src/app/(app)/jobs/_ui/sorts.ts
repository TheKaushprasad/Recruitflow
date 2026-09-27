export const SORTS = { newest: "Newest first", oldest: "Oldest first", applicants: "Most applicants", review: "Needs review first" } as const;
export type SortKey = keyof typeof SORTS;
