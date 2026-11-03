import { Redis } from "ioredis";
import { config } from "../config.js";

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (_redis) return _redis;
  _redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  return _redis;
}

export function createRedis(): Redis {
  return new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
}
