import {
  DbRef,
  type CommittedRow,
  type InsertInput,
} from '../../src/table.js';

interface PostRow {
  [key: string]: unknown;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

declare const db: DbRef<{ posts: PostRow }>;

async function consumeCommittedInsertRow(): Promise<void> {
  const input: InsertInput<PostRow> = { title: 'Synthetic post' };
  // @ts-expect-error Insert request data does not guarantee storage-owned fields.
  const inputIsNotCommitted: CommittedRow<PostRow> = input;
  const directCommitted: CommittedRow<PostRow> = await db.table('posts').insert(input);
  const transaction = await db.transact([
    { table: 'posts', op: 'insert', data: input },
    {
      table: 'posts',
      op: 'expect',
      id: 'post-old',
      where: [['title', '==', 'Old title']],
      exists: true,
    },
    { table: 'posts', op: 'delete', id: 'post-old' },
  ]);

  const committed: PostRow = transaction.results[0].inserted;
  const conservativeNonInsertResult: Record<string, unknown> = transaction.results[2];

  void committed.updatedAt;
  void directCommitted.createdAt;
  void inputIsNotCommitted;
  void conservativeNonInsertResult;
}

void consumeCommittedInsertRow;
