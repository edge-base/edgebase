// ─── Common Utility Types ───

export type FilterOperator =
  | '=='
  | '!='
  | '>'
  | '<'
  | '>='
  | '<='
  | 'contains'
  | 'contains-any'
  | 'in'
  | 'not in'
  | 'not-in';

export type SortDirection = 'asc' | 'desc';
