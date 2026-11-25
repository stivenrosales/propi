// In-memory ports for use-case tests and adapter contract tests.
export { createMemoryPorts, type EventRecord, type MemoryOptions, type MemoryPorts } from "./memory.ts";
export { withShopStore, createGiftCardFake, type GiftCardFake, type ShopStore, type ShopStoreBase, type ShopStoreOptions } from "./shop.ts";
export { createEngagementMemory, engagementHandlers, type EngagementDeps, type EngagementMemory, type EngagementState } from "./engagement.ts";
export { createMemoryInsights, type MemoryInsights } from "./insights.ts";
export { createMemoryApiStores, type MemoryApiStores } from "./api.ts";
export { createMemoryIdentityStore } from "./identity.ts";
