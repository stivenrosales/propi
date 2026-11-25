// @propi/heytaco — HeyTaco export adapter: parsers, import handlers and the import runner (S101-S105).
// The mapping rules live in core/migration; this package only reads files and wires the app.
export * from "../../core/src/migration/index.ts";
export { planImport as planHeyTacoImport } from "../../core/src/migration/index.ts";
export { unzip } from "./zip.ts";
export { readXlsxGrid, readXlsxRows, type CellValue } from "./xlsx.ts";
export { parseCsv, parseCsvGrid } from "./csv.ts";
export { readHeyTacoExport, activityRows, userRows, redemptionRows, ACTIVITY_COLUMNS, USER_COLUMNS, REDEMPTION_COLUMNS } from "./export.ts";
export { HEYTACO_HANDLERS } from "./handlers.ts";
export { importHeyTaco, type ImportRun, type ImportedMember, type MemberRegistrar } from "./run.ts";
