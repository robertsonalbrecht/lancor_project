# Database Migrations

Each file in this directory is a numbered SQL migration. Apply them in order against the Supabase SQL Editor to update the database schema.

## Naming convention

```
001_initial_schema.sql
002_add_some_column.sql
003_create_new_table.sql
```

## How to apply

1. Open the Supabase dashboard → SQL Editor
2. Paste the contents of the next migration file
3. Run it
4. Migrations are not re-runnable by default — only run each one once
