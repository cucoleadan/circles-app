import { connect } from "node:net"

const sshHost = process.env.CIRCLES_SSH_HOST ?? "home"
const localDatabasePort = Number(process.env.CIRCLES_DB_PORT ?? 5433)
const remoteDatabasePort = 15432
const databaseProxy = "circles-dev-db-proxy"
const databaseEnvFile = "/home/dan/.config/dokploy/circles-db.env"

let tunnel: Bun.Subprocess | undefined
let apps: Bun.Subprocess[] = []
let stopping = false

async function remote(command: string) {
  const process = Bun.spawn(["ssh", sshHost, command], {
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  if (exitCode !== 0)
    throw new Error(stderr.trim() || `SSH command failed (${exitCode}).`)
  return stdout.trim()
}

function portIsOpen(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ host: "127.0.0.1", port })
    const finish = (open: boolean) => {
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(300)
    socket.once("connect", () => finish(true))
    socket.once("timeout", () => finish(false))
    socket.once("error", () => finish(false))
  })
}

async function waitForTunnel() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (tunnel?.exitCode !== null)
      throw new Error("The SSH database tunnel stopped unexpectedly.")
    if (await portIsOpen(localDatabasePort)) return
    await Bun.sleep(200)
  }
  throw new Error("The database tunnel did not become ready.")
}

async function verifyDatabase(databaseUrl: string) {
  const { Client } = await import("pg")
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
  })
  try {
    await client.connect()
    await client.query("select 1")
  } finally {
    await client.end()
  }
}

function killTree(child: Bun.Subprocess | undefined) {
  if (!child || child.exitCode !== null) return
  if (process.platform === "win32") {
    Bun.spawn(["taskkill", "/PID", String(child.pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
      windowsHide: true,
    })
  } else {
    child.kill("SIGTERM")
  }
}

function stop(exitCode: number) {
  if (stopping) return
  stopping = true
  for (const app of apps) killTree(app)
  killTree(tunnel)
  setTimeout(() => {
    process.exit(exitCode)
  }, 300)
}

process.on("SIGINT", () => stop(130))
process.on("SIGTERM", () => stop(143))

try {
  if (await portIsOpen(localDatabasePort)) {
    throw new Error(
      `Port ${localDatabasePort} is already in use. Close the old tunnel and try again.`
    )
  }

  console.log("Connecting to the private Circles database…")
  await remote(`docker start ${databaseProxy}`)

  const remoteDatabaseUrl = (
    await remote(`sed -n 's/^DATABASE_URL=//p' ${databaseEnvFile}`)
  ).replace(/^['"]|['"]$/g, "")
  const databaseUrl = new URL(remoteDatabaseUrl)
  databaseUrl.hostname = "127.0.0.1"
  databaseUrl.port = String(localDatabasePort)

  tunnel = Bun.spawn(
    [
      "ssh",
      "-o",
      "ExitOnForwardFailure=yes",
      "-N",
      "-L",
      `${localDatabasePort}:127.0.0.1:${remoteDatabasePort}`,
      sshHost,
    ],
    { stdin: "ignore", stdout: "inherit", stderr: "inherit", windowsHide: true }
  )
  await waitForTunnel()
  await verifyDatabase(databaseUrl.toString())
  console.log(`Database tunnel ready on localhost:${localDatabasePort}.`)

  if (process.argv.includes("--check")) {
    console.log("Development connection check passed.")
    stop(0)
  } else {
    const root = import.meta.dir + "/.."
    const env = {
      ...process.env,
      DATABASE_URL: databaseUrl.toString(),
      APP_URL: "http://localhost:4321",
      API_INTERNAL_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ??
        crypto.randomUUID() + crypto.randomUUID(),
      ALLOW_SIGNUP: process.env.ALLOW_SIGNUP ?? "false",
      ASTRO_DEV_BACKGROUND: "0",
    }
    const spawn = (command: string[], cwd: string) =>
      Bun.spawn(command, {
        cwd,
        env,
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
        windowsHide: false,
      })

    console.log("Starting API, worker, and web app…")
    apps = [
      spawn(
        [process.execPath, "x", "tsx", "watch", "src/index.ts"],
        `${root}/apps/api`
      ),
      spawn(
        [process.execPath, "x", "tsx", "watch", "src/index.ts"],
        `${root}/apps/worker`
      ),
      spawn(
        [process.execPath, "x", "astro", "dev", "--ignore-lock"],
        `${root}/apps/web`
      ),
    ]
    stop(await Promise.race(apps.map((app) => app.exited)))
  }
} catch (error) {
  console.error(
    error instanceof Error
      ? `\nCould not start development: ${error.message}`
      : error
  )
  stop(1)
}
