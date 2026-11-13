/**
 * Records & analytics (§12, §13, §17, §18, §22, §25): customer health,
 * contracts and renewals, record version history, metric anomaly watches and
 * public dashboard links. One entry point because the six share types (a health
 * band rides on a contract, a contract has versions) and one prefix of pages;
 * each surface lives in its own module beside this one.
 */

export * from "./health";
export * from "./contracts";
export * from "./versions";
export * from "./alerts";
export * from "./links";
export * from "./grid";
export * from "./format";
