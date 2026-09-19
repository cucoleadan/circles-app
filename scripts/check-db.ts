import { Pool } from 'pg'

const db = new Pool({ connectionString: process.env.DATABASE_URL })

async function check() {
  try {
    // Check how many people can be updated from profile_snapshots with payload->'profile'->>'photoUrl'
    const snapshotMatch = await db.query(`
      select count(distinct p.id) as count
      from people p
      join profile_snapshots ps on ps.person_id = p.id
      where coalesce(
        ps.payload->'profile'->>'photoUrl',
        ps.payload->'profile'->>'photo_url',
        ps.payload->>'photoUrl',
        ps.payload->>'photo_url',
        ps.payload->>'avatar_url'
      ) is not null
      and (p.avatar_url is null or p.avatar_url = '')
    `)
    console.log('Unpopulated contacts with photos in profile_snapshots:', snapshotMatch.rows[0].count)

    // Check how many people can be updated from interactions metadata
    const interactionMatch = await db.query(`
      select count(distinct p.id) as count
      from people p
      join interactions i on i.person_id = p.id
      where coalesce(
        i.metadata->>'actorAvatarUrl',
        i.metadata->>'authorPhotoUrl',
        i.metadata->>'photoUrl',
        i.metadata->>'photo_url'
      ) is not null
      and (p.avatar_url is null or p.avatar_url = '')
    `)
    console.log('Unpopulated contacts with photos in interactions:', interactionMatch.rows[0].count)

  } catch (err: any) {
    console.error('Error:', err.message)
  } finally {
    await db.end()
  }
}

check()
