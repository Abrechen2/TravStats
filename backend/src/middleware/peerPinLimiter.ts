import rateLimit from "express-rate-limit";
import { userOrIpKey } from "./rateLimit";

/** Admin pinning of a peer server (`POST /admin/federation/peers`): a Companion scan, not a loop. */
export const peerPinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: "Too many server pins in a short time — please slow down",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});
