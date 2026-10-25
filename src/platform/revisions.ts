import { Env } from "../shared/types";
import { randomId } from "../shared/crypto";
import { now } from "../shared/repo";
import { getDb, postRevisions, postAutosaves, eq, and, desc, sql } from "../shared/db";

export async function createRevision(
  env: Env,
  postId: string,
  authorId: string | null,
  locale: string,
  title: string,
  excerpt: string,
  content: string
) {
  const db = getDb(env);
  const latest = await db
    .select({ version: postRevisions.version })
    .from(postRevisions)
    .where(and(eq(postRevisions.post_id, postId), eq(postRevisions.locale, locale)))
    .orderBy(desc(postRevisions.version))
    .limit(1)
    .get();
  const version = Number(latest?.version || 0) + 1;
  await db.insert(postRevisions).values({
    id: await randomId(),
    post_id: postId,
    author_id: authorId ?? "",
    version,
    title,
    excerpt,
    content,
    locale,
    created_at: now(),
  });
  return version;
}

export async function autosave(
  env: Env,
  postId: string,
  userId: string,
  locale: string,
  b: any
) {
  const db = getDb(env);
  await db
    .insert(postAutosaves)
    .values({
      post_id: postId,
      user_id: userId,
      locale,
      title: String(b.title || ""),
      excerpt: String(b.excerpt || ""),
      content: typeof b.content === "string" ? b.content : JSON.stringify(b.content || []),
      updated_at: now(),
    })
    .onConflictDoUpdate({
      target: [postAutosaves.post_id, postAutosaves.user_id, postAutosaves.locale],
      set: {
        title: sql`excluded.title`,
        excerpt: sql`excluded.excerpt`,
        content: sql`excluded.content`,
        updated_at: sql`excluded.updated_at`,
      },
    });
}
