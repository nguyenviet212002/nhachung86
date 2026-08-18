export default {
  client: 'pg',
  connection: process.env.MIGRATION_DATABASE_URL,
  migrations: { directory: './src/db/migrations', extension: 'js' },
};
