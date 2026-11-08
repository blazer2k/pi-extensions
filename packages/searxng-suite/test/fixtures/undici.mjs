export * from "undici";
import { fetch as nativeFetch } from "undici";
import { state } from "../no-network.mjs";
export const fetch = (...args) =>
  state.fetch ? state.fetch(...args) : nativeFetch(...args);
