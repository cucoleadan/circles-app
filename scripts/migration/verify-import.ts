import { Pool } from "pg"

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function main() {
  const users = await pool.query(`
    select u.id, u.email, au.id as app_user_id, count(p.id) as people_count
    from "user" u
    left join app_users au on au.auth_user_id = u.id
    left join people p on p.user_id = au.id
    group by u.id, u.email, au.id
  `)
  console.log("Users & Contact counts:", users.rows)

  const stats = await pool.query(`
    select 
      count(*) as total_people,
      count(s.engagement_score) as with_stats,
      avg(s.engagement_score)::numeric(10,2) as avg_score,
      max(s.engagement_score) as max_score,
      min(s.engagement_score) as min_score
    from people p
    join relationship_stats s on s.person_id = p.id
  `)
  console.log("Stats summary:", stats.rows[0])

  const topEngaged = await pool.query(`
    select p.name, p.handle, s.engagement_score, s.interaction_count, s.drift_status, s.last_interaction_at
    from people p
    join relationship_stats s on s.person_id = p.id
    order by s.engagement_score desc limit 5
  `)
  console.log("\nTop 5 Engaged Contacts:")
  console.table(topEngaged.rows)

  const lists = await pool.query(`
    select l.name, count(lm.person_id) as member_count
    from lists l
    left join list_members lm on lm.list_id = l.id
    group by l.id, l.name
  `)
  console.log("\nLists:")
  console.table(lists.rows)

  await pool.end()
}

main().catch(console.error)
