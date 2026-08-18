import knexLib from 'knex';
import { config } from '../config/index.js';

export const knex = knexLib({
  client: 'pg',
  connection: config.DATABASE_URL,
  pool: { min: 2, max: 10 },
});

export default knex;
