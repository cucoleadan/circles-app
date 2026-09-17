import { connect } from "node:net"

const sshHost = process.env.CIRCLES_SSH_HOST ?? "home"
const localDatabasePort = Number(process.env.CIRCLES_DB_PORT ?? 5433)
const databaseService = "circles-postgres-wgemxn"
const databaseEnvFile = "/home/dan/.config/dokploy/circles-db.env"

let tunnel: Bun.Subprocess | undefined
let apps: Bun.Subprocess | undefined
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

function stop(exitCode: number) {
  if (stopping) return
  stopping = true
  apps?.kill("SIGTERM")
  tunnel?.kill("SIGTERM")
  setTimeout(() => {
    apps?.kill("SIGKILL")
    tunnel?.kill("SIGKILL")
    process.exit(exitCode)
  }, 1_000)
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

  const containerId = (
    await remote(
      `docker ps --filter name=${databaseService} --format '{{.ID}}'`
    )
  )
    .split(/\r?\n/)
    .find(Boolean)
  if (!containerId || !/^[a-f0-9]+$/i.test(containerId))
    throw new Error("The Circles PostgreSQL container is not running.")

  const databaseIp = await remote(
    `docker inspect ${containerId} --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'`
  )
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(databaseIp))
    throw new Error("Could not resolve the private PostgreSQL address.")

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
      `${localDatabasePort}:${databaseIp}:5432`,
      sshHost,
    ],
    { stdin: "ignore", stdout: "inherit", stderr: "inherit", windowsHide: true }
  )
  await waitForTunnel()
  console.log(`Database tunnel ready on localhost:${localDatabasePort}.`)

  if (process.argv.includes("--check")) {
    console.log("Development connection check passed.")
    stop(0)
  } else {
    apps = Bun.spawn([process.execPath, "x", "turbo", "dev", "--ui=stream"], {
      cwd: import.meta.dir + "/..",
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl.toString(),
        APP_URL: "http://localhost:4321",
        API_INTERNAL_URL: "http://localhost:3000",
        BETTER_AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
        ALLOW_SIGNUP: "false",
      },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      windowsHide: false,
    })
    stop(await apps.exited)
  }
} catch (error) {
  console.error(
    error instanceof Error
      ? `\nCould not start development: ${error.message}`
      : error
  )
  stop(1)
}
