#!/usr/bin/env python3
"""
Prisma ORM setup script.
- Asks which database / adapter the user wants
- Writes prisma.config.ts, patches schema.prisma, creates lib/prisma.ts
- Auto-detects src/lib, lib, src or root for prisma.ts placement
- Creates a .env.example with the right variables
- Does NOT install npm packages (handled by the template runner)
"""

import os
import sys
import re

# ── DB catalogue ────────────────────────────────────────────────────────────

DATABASES = [
    {
        "label": "PostgreSQL (pg)",
        "provider": "postgresql",
        "adapter_pkg": "@prisma/adapter-pg",
        "adapter_import": "PrismaPg",
        "adapter_from": "@prisma/adapter-pg",
        "adapter_init": 'new PrismaPg({ connectionString: process.env.DATABASE_URL })',
        "env_vars": {"DATABASE_URL": "postgresql://user:password@localhost:5432/mydb"},
        "extra_deps": ["pg"],
    },
    {
        "label": "Neon (serverless Postgres)",
        "provider": "postgresql",
        "adapter_pkg": "@prisma/adapter-neon",
        "adapter_import": "PrismaNeon",
        "adapter_from": "@prisma/adapter-neon",
        "adapter_init": 'new PrismaNeon({ connectionString: process.env.DATABASE_URL })',
        "env_vars": {"DATABASE_URL": "postgresql://user:password@ep-xxx.us-east-1.aws.neon.tech/mydb?sslmode=require"},
        "extra_deps": ["@neondatabase/serverless"],
    },
    {
        "label": "MariaDB / MySQL (mariadb)",
        "provider": "mysql",
        "adapter_pkg": "@prisma/adapter-mariadb",
        "adapter_import": "PrismaMariaDb",
        "adapter_from": "@prisma/adapter-mariadb",
        "adapter_init": (
            "new PrismaMariaDb({\n"
            "  host: process.env.DB_HOST ?? 'localhost',\n"
            "  port: Number(process.env.DB_PORT ?? 3306),\n"
            "  user: process.env.DB_USER,\n"
            "  password: process.env.DB_PASSWORD,\n"
            "  database: process.env.DB_NAME,\n"
            "  connectionLimit: 5,\n"
            "})"
        ),
        "env_vars": {
            "DB_HOST": "localhost",
            "DB_PORT": "3306",
            "DB_USER": "myuser",
            "DB_PASSWORD": "mypassword",
            "DB_NAME": "mydb",
        },
        "extra_deps": ["mariadb"],
    },
    {
        "label": "PlanetScale (MySQL-compatible, HTTP)",
        "provider": "mysql",
        "adapter_pkg": "@prisma/adapter-planetscale",
        "adapter_import": "PrismaPlanetScale",
        "adapter_from": "@prisma/adapter-planetscale",
        "adapter_init": (
            "new PrismaPlanetScale({\n"
            "  url: process.env.DATABASE_URL,\n"
            "  // fetch: undiciFetch, // uncomment for Node.js < 18\n"
            "})"
        ),
        "env_vars": {"DATABASE_URL": "mysql://user:password@aws.connect.psdb.cloud/mydb?sslaccept=strict"},
        "extra_deps": ["@planetscale/database"],
        "extra_comment": "// import { fetch as undiciFetch } from 'undici'; // Node.js < 18 only\n",
    },
    {
        "label": "SQLite (better-sqlite3)",
        "provider": "sqlite",
        "adapter_pkg": "@prisma/adapter-better-sqlite3",
        "adapter_import": "PrismaBetterSqlite3",
        "adapter_from": "@prisma/adapter-better-sqlite3",
        "adapter_init": 'new PrismaBetterSqlite3({ url: "file:./prisma/dev.db" })',
        "env_vars": {},
        "extra_deps": ["better-sqlite3", "@types/better-sqlite3"],
    },
    {
        "label": "Turso / libSQL",
        "provider": "sqlite",
        "adapter_pkg": "@prisma/adapter-libsql",
        "adapter_import": "PrismaLibSQL",
        "adapter_from": "@prisma/adapter-libsql",
        "adapter_init": (
            "new PrismaLibSQL({\n"
            "  url: process.env.TURSO_DATABASE_URL!,\n"
            "  authToken: process.env.TURSO_AUTH_TOKEN,\n"
            "})"
        ),
        "env_vars": {
            "TURSO_DATABASE_URL": "libsql://your-db.turso.io",
            "TURSO_AUTH_TOKEN": "your-auth-token",
        },
        "extra_deps": ["@libsql/client"],
    },
    {
        "label": "SQL Server / Azure SQL (mssql)",
        "provider": "sqlserver",
        "adapter_pkg": "@prisma/adapter-mssql",
        "adapter_import": "PrismaMssql",
        "adapter_from": "@prisma/adapter-mssql",
        "adapter_init": (
            "new PrismaMssql({\n"
            "  server: process.env.DB_HOST ?? 'localhost',\n"
            "  port: Number(process.env.DB_PORT ?? 1433),\n"
            "  database: process.env.DB_NAME,\n"
            "  user: process.env.DB_USER,\n"
            "  password: process.env.DB_PASSWORD,\n"
            "  options: { encrypt: true, trustServerCertificate: true },\n"
            "})"
        ),
        "env_vars": {
            "DB_HOST": "localhost",
            "DB_PORT": "1433",
            "DB_NAME": "mydb",
            "DB_USER": "sa",
            "DB_PASSWORD": "mypassword",
        },
        "extra_deps": ["mssql", "@types/mssql"],
    },
    {
        "label": "Cloudflare D1 (Workers only)",
        "provider": "sqlite",
        "adapter_pkg": "@prisma/adapter-d1",
        "adapter_import": "PrismaD1",
        "adapter_from": "@prisma/adapter-d1",
        "adapter_init": "new PrismaD1(env.DB) // D1 binding injected by the Workers runtime",
        "env_vars": {},
        "extra_deps": [],
        "extra_comment": (
            "// Note: `env.DB` is the D1 binding defined in your wrangler.toml.\n"
            "// This adapter only works inside a Cloudflare Worker.\n"
        ),
    },
]

# ── helpers ─────────────────────────────────────────────────────────────────

def detect_lib_dir() -> str:
    """
    Decide where to write lib/prisma.ts, then ensure the directory exists.

    Priority:
      1. src/lib/  already exists  -> use it   (Next.js / SvelteKit src layout)
      2. lib/      already exists  -> use it   (plain Next.js / Node)
      3. src/      already exists  -> create src/lib/ inside it
      4. nothing   exists          -> create lib/  (safest universal default)

    The directory is created (if needed) before returning.
    """
    if os.path.isdir(os.path.join("src", "lib")):
        chosen = os.path.join("src", "lib")
        reason = "existing src/lib/"
    elif os.path.isdir("lib"):
        chosen = "lib"
        reason = "existing lib/"
    elif os.path.isdir("src"):
        chosen = os.path.join("src", "lib")
        reason = "src/ found -> creating src/lib/"
    else:
        chosen = "lib"
        reason = "no src/ or lib/ found -> creating lib/"

    os.makedirs(chosen, exist_ok=True)
    print(f"  ℹ lib dir: {chosen!r}  ({reason})")
    return chosen


def prompt_choice(question: str, options: list[str]) -> int:
    """Print a numbered menu and return the 0-based index of the chosen item."""
    print(f"\n{question}")
    for i, opt in enumerate(options, 1):
        print(f"  {i}. {opt}")
    while True:
        raw = input("Enter number: ").strip()
        if raw.isdigit():
            idx = int(raw) - 1
            if 0 <= idx < len(options):
                return idx
        print(f"  Please enter a number between 1 and {len(options)}.")


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def write_file(path: str, content: str) -> None:
    ensure_dir(os.path.dirname(path) or ".")
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  ✔ wrote {path}")


# ── template builders ────────────────────────────────────────────────────────

def build_prisma_config(output_dir: str, provider: str) -> str:
    return f"""\
import "dotenv/config";
import {{ defineConfig, env }} from "prisma/config";

export default defineConfig({{
  schema: "prisma/schema.prisma",
  migrations: {{
    path: "prisma/migrations",
  }},
  datasource: {{
    // Overrides the url in schema.prisma at runtime
    url: env("DATABASE_URL"),
  }},
}});
"""


def build_schema_prisma(output_dir: str, provider: str) -> str:
    """
    Returns a minimal schema.prisma with the correct provider and output dir.
    If a schema.prisma already exists we patch it instead (see patch_schema).
    """
    return f"""\
// This file is the single source of truth for your data model.
// Run `npx prisma migrate dev` to apply changes.

generator client {{
  provider = "prisma-client"
  output   = "{output_dir}"
}}

datasource db {{
  provider = "{provider}"
  url      = env("DATABASE_URL")
}}

// Add your models below ↓
"""


def patch_schema(schema_path: str, output_dir: str, provider: str) -> None:
    """
    If schema.prisma already exists (created by `prisma init`), update
    the generator output and datasource provider in-place.
    """
    with open(schema_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Patch / insert output in generator block
    if re.search(r'output\s*=', content):
        content = re.sub(r'output\s*=\s*"[^"]*"', f'output   = "{output_dir}"', content)
    else:
        content = re.sub(
            r'(generator client \{[^}]*)(})',
            lambda m: m.group(1) + f'  output   = "{output_dir}"\n' + m.group(2),
            content,
            flags=re.DOTALL,
        )

    # Patch provider
    content = re.sub(
        r'(datasource db \{[^}]*provider\s*=\s*)"[^"]*"',
        rf'\g<1>"{provider}"',
        content,
        flags=re.DOTALL,
    )

    write_file(schema_path, content)


def build_prisma_ts(db: dict, output_dir: str) -> str:
    extra_comment = db.get("extra_comment", "")
    adapter_init  = db["adapter_init"]

    # Re-indent multi-line adapter_init: content lines get 2-space, closing }) gets none
    lines = adapter_init.splitlines()
    if len(lines) > 1:
        result = [lines[0]]
        for l in lines[1:]:
            stripped = l.strip()
            if stripped in ("}", "})", "});"):
                result.append(stripped)
            elif stripped:
                result.append("  " + stripped)
            else:
                result.append("")
        indented = "\n".join(result)
    else:
        indented = lines[0]

    return f"""\
import {{ {db["adapter_import"]} }} from "{db["adapter_from"]}";
import {{ PrismaClient }} from "{output_dir}";
{extra_comment}
const adapter = {indented};

const prisma = new PrismaClient({{ adapter }});

export default prisma;
"""


def build_env_example(db: dict) -> str:
    if not db["env_vars"]:
        return "# No environment variables required for this adapter.\n"
    lines = ["# Copy to .env and fill in your values\n"]
    for key, val in db["env_vars"].items():
        lines.append(f'{key}="{val}"')
    return "\n".join(lines) + "\n"


# ── main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    print("┌─────────────────────────────────────────┐")
    print("│  Prisma ORM — interactive setup script  │")
    print("└─────────────────────────────────────────┘")

    # 1. Pick database / adapter
    labels = [db["label"] for db in DATABASES]
    db_idx = prompt_choice("Which database are you using?", labels)
    db = DATABASES[db_idx]

    # 2. Output dir (matches the {{prisma_output_dir}} variable)
    default_output = "../generated/prisma"
    raw = input(f"\nGenerated client output dir [{default_output}]: ").strip()
    output_dir = raw if raw else default_output

    # 3. Derive paths
    schema_path = os.path.join("prisma", "schema.prisma")
    config_path = "prisma.config.ts"
    lib_dir  = detect_lib_dir()
    lib_path = os.path.join(lib_dir, "prisma.ts")
    env_example  = ".env.example"

    print(f"\n── Writing files for [{db['label']}] ──")

    # 4. prisma.config.ts
    write_file(config_path, build_prisma_config(output_dir, db["provider"]))

    # 5. schema.prisma — patch if it already exists, create if not
    if os.path.exists(schema_path):
        print(f"  ↻ patching existing {schema_path}")
        patch_schema(schema_path, output_dir, db["provider"])
    else:
        write_file(schema_path, build_schema_prisma(output_dir, db["provider"]))

    # 6. lib/prisma.ts
    write_file(lib_path, build_prisma_ts(db, output_dir))

    # 7. .env.example
    write_file(env_example, build_env_example(db))

    # 8. Emit the extra npm dependencies the runner should install
    all_deps = [db["adapter_pkg"]] + db.get("extra_deps", [])
    print("\n── Additional npm dependencies needed ──")
    for dep in all_deps:
        print(f"  • {dep}")

    # Write a machine-readable file so the template runner can pick them up
    deps_file = ".prisma-extra-deps"
    with open(deps_file, "w") as f:
        f.write("\n".join(all_deps) + "\n")
    print(f"\n  ✔ dependency list written to {deps_file}")

    print("\n✅  Done! Next steps:")
    print("  1. Copy .env.example → .env and fill in your credentials")
    if all_deps:
        print(f"  2. Install adapter: npm install {' '.join(all_deps)}")
    print("  3. Run: npx prisma migrate dev   (or prisma db pull for existing DBs)")
    print("  4. Run: npx prisma generate")
    import_path = lib_path.replace(os.sep, '/').removesuffix('.ts')
    print(f"  5. Import prisma from '{import_path}' in your app")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nAborted.")
        sys.exit(1)