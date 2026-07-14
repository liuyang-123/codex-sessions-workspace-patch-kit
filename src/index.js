#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const PATCH_ID = "codex-sessions-workspace-patch-v5";
const BACKUP_ROOT_NAME = ".codex-sessions-patch-backups";
const OPENAI_EXTENSION_PREFIX = "openai.chatgpt-";

const PATCHES = [
  {
    id: "extension-host-workspace-filter-helper",
    targetRelativePath: path.join("out", "extension.js"),
    description:
      "Add extension-host helpers that filter thread/list results by the current VS Code workspace roots.",
    find:
      "var $de=require(\"path\");U();Mt();var cy=B(require(\"vscode\"));U();Mt();ec();",
    replace:
      "var $de=require(\"path\");U();Mt();var cy=B(require(\"vscode\"));function codexSessionsPatchNormalizePath(e){if(typeof e!=\"string\"||e.length===0||e===\"~\")return null;let r=e.replace(/\\\\/g,\"/\").replace(/\\/+$/,\"\");return/^[a-zA-Z]:\\//.test(r)||r.startsWith(\"//\")?r.toLowerCase():r}function codexSessionsPatchCwdBelongsToWorkspace(e,r){let n=codexSessionsPatchNormalizePath(e);if(n==null)return!1;return r.some(e=>{let r=codexSessionsPatchNormalizePath(e);return r!=null&&(n===r||n.startsWith(`${r}/`))})}function codexSessionsPatchThreadHasWorkspacePath(e){return typeof e?.cwd===\"string\"&&e.cwd.length>0||Array.isArray(e?.cwds)&&e.cwds.some(e=>typeof e===\"string\"&&e.length>0)}function codexSessionsPatchThreadBelongsToWorkspace(e,r){return codexSessionsPatchCwdBelongsToWorkspace(e?.cwd,r)||Array.isArray(e?.cwds)&&e.cwds.some(e=>codexSessionsPatchCwdBelongsToWorkspace(e,r))}function codexSessionsPatchFilterThreadListResponse(e){try{let r=cy.workspace.workspaceFolders?.map(e=>e.uri.fsPath)??[];if(r.length===0||e==null||e.error||e.result==null||!Array.isArray(e.result.data)||!e.result.data.some(codexSessionsPatchThreadHasWorkspacePath))return e;let n=e.result.data.filter(e=>codexSessionsPatchThreadBelongsToWorkspace(e,r));return{...e,result:{...e.result,data:n}}}catch{return e}}U();Mt();ec();",
  },
  {
    id: "extension-host-track-thread-list-requests",
    targetRelativePath: path.join("out", "extension.js"),
    description:
      "Track thread/list request IDs so only those responses are workspace-filtered.",
    find:
      "pendingNotifications=[];internalNotificationHandlers=new Set;ephemeralThreadTimeouts=new Map;pendingPrewarmedThreadStartRequestIds=new Set;prewarmedThreads=new jh",
    replace:
      "pendingNotifications=[];internalNotificationHandlers=new Set;ephemeralThreadTimeouts=new Map;pendingPrewarmedThreadStartRequestIds=new Set;threadListRequestIds=new Set;prewarmedThreads=new jh",
  },
  {
    id: "extension-host-record-thread-list-requests",
    targetRelativePath: path.join("out", "extension.js"),
    description:
      "Record outgoing thread/list request IDs and widen thread/list pages before sending them to the app server.",
    find:
      "sendProviderRequest(e,r,n,o,i){let s=`${e}:${r}`;i&&this.pendingPrewarmedThreadStartRequestIds.add(s);let a={id:s,method:n,params:o};if(this.recordLastOutboundMethod(n),this.sendMessage(a)&&n===\"turn/start\"){let c=__(o);c!=null&&this.prewarmedThreads.publishThreadStarted(c)}}",
    replace:
      "sendProviderRequest(e,r,n,o,i){let s=`${e}:${r}`;i&&this.pendingPrewarmedThreadStartRequestIds.add(s),(e===\"codex.chatSessionProvider\"||e===\"CodexWebviewProvider.webview\")&&n===\"thread/list\"&&(this.threadListRequestIds.add(s),o={...o,limit:Math.max(Number(o?.limit)||0,500)});let a={id:s,method:n,params:o};if(this.recordLastOutboundMethod(n),this.sendMessage(a)&&n===\"turn/start\"){let c=__(o);c!=null&&this.prewarmedThreads.publishThreadStarted(c)}}",
  },
  {
    id: "extension-host-filter-thread-list-responses",
    targetRelativePath: path.join("out", "extension.js"),
    description:
      "Filter tracked thread/list responses by workspace before routing them to webviews or chat-session providers.",
    find:
      "let s=this.providers.get(n);if(s?.onResult){let a={...e,id:i};s.onResult(a)}return{routeKind:\"response\",method:null}}",
    replace:
      "let s=this.providers.get(n),a=this.threadListRequestIds.delete(r)?codexSessionsPatchFilterThreadListResponse(e):e;if(s?.onResult){let e={...a,id:i};s.onResult(e)}return{routeKind:\"response\",method:null}}",
  },
];

function main() {
  const [command = "status", ...args] = process.argv.slice(2);
  const options = parseOptions(args);

  try {
    if (command === "scan" || command === "status") {
      const report = scanInstallation(options);
      printReport(report);
      process.exit(report.ok ? 0 : 1);
    }

    if (command === "apply") {
      const report = applyPatches(options);
      printApplyReport(report);
      process.exit(report.ok ? 0 : 1);
    }

    if (command === "repair") {
      const report = repairInstallation(options);
      printRepairReport(report);
      process.exit(report.ok ? 0 : 1);
    }

    if (command === "restore") {
      const report = restoreLatestBackup(options);
      printRestoreReport(report);
      process.exit(report.ok ? 0 : 1);
    }

    usage(`Unknown command: ${command}`);
  } catch (error) {
    console.error(`[${PATCH_ID}] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

function parseOptions(args) {
  const options = {
    dryRun: false,
    extensionRoot: null,
    vscodeExtensionsDir: null,
    backupRoot: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (value === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (value === "--extension-root") {
      options.extensionRoot = requireValue(args, ++index, value);
      continue;
    }

    if (value === "--extensions-dir") {
      options.vscodeExtensionsDir = requireValue(args, ++index, value);
      continue;
    }

    if (value === "--backup-root") {
      options.backupRoot = requireValue(args, ++index, value);
      continue;
    }

    usage(`Unknown option: ${value}`);
  }

  return options;
}

function requireValue(args, index, flag) {
  const value = args[index];
  if (!value) {
    usage(`Missing value for ${flag}`);
  }
  return value;
}

function usage(message) {
  if (message) {
    console.error(message);
  }
  console.error(
    [
      "Usage:",
      "  node src/index.js status [--extension-root <path>]",
      "  node src/index.js scan [--extension-root <path>]",
      "  node src/index.js apply [--dry-run] [--extension-root <path>] [--backup-root <path>]",
      "  node src/index.js repair [--extension-root <path>] [--backup-root <path>]",
      "  node src/index.js restore [--extension-root <path>] [--backup-root <path>]",
    ].join("\n")
  );
  process.exit(1);
}

function scanInstallation(options) {
  const extensionRoot = resolveExtensionRoot(options);
  const targetReports = buildTargetReports(extensionRoot);
  const patchStates = targetReports.flatMap((report) => report.patchStates);

  return {
    ok: patchStates.every((state) => state.status !== "missing"),
    extensionRoot,
    targetReports,
    patchStates,
    alreadyPatched: patchStates.every((state) => state.status === "patched"),
  };
}

function applyPatches(options) {
  const scan = scanInstallation(options);
  const missing = scan.patchStates.filter((state) => state.status === "missing");

  if (missing.length > 0) {
    return {
      ok: false,
      extensionRoot: scan.extensionRoot,
      targetReports: scan.targetReports,
      patchStates: scan.patchStates,
      dryRun: options.dryRun,
      changed: false,
      backupDir: null,
      message: "One or more patch anchors were not found in the installed bundle.",
    };
  }

  const nextContentsByTarget = new Map();
  const changedFiles = [];

  for (const report of scan.targetReports) {
    let next = report.contents;
    let changed = false;

    for (const patch of report.patches) {
      const state = evaluatePatch(next, patch);
      if (state.status === "original") {
        next = next.replace(patch.find, patch.replace);
        changed = true;
      }
    }

    nextContentsByTarget.set(report.targetFile, next);
    if (changed) {
      changedFiles.push({
        relativePath: report.targetRelativePath,
        targetFile: report.targetFile,
        originalContents: report.contents,
        nextContents: next,
      });
    }
  }

  const backupDir =
    changedFiles.length > 0 && !options.dryRun
      ? createBackup(scan.extensionRoot, changedFiles, options)
      : null;

  if (!options.dryRun) {
    for (const file of changedFiles) {
      fs.writeFileSync(file.targetFile, file.nextContents, "utf8");
    }
  }

  const rescanned = buildTargetReports(
    scan.extensionRoot,
    new Map(
      scan.targetReports.map((report) => [
        report.targetFile,
        changedFiles.some((file) => file.targetFile === report.targetFile)
          ? nextContentsByTarget.get(report.targetFile)
          : report.contents,
      ])
    )
  );

  return {
    ok: true,
    extensionRoot: scan.extensionRoot,
    targetReports: rescanned,
    patchStates: rescanned.flatMap((report) => report.patchStates),
    dryRun: options.dryRun,
    changed: changedFiles.length > 0,
    backupDir,
    message:
      changedFiles.length > 0
        ? options.dryRun
          ? "Dry run completed. The v5 patch can be applied cleanly."
          : "V4 patch applied."
        : "Target files were already patched.",
    };
}

function repairInstallation(options) {
  const scan = scanInstallation(options);
  const statusCounts = countPatchStatuses(scan.patchStates);

  if (statusCounts.missing > 0) {
    return {
      ok: false,
      outcome: "retarget needed",
      extensionRoot: scan.extensionRoot,
      targetReports: scan.targetReports,
      patchStates: scan.patchStates,
      dryRun: false,
      changed: false,
      backupDir: null,
      message: "One or more patch anchors were not found. Retarget the patch before writing.",
    };
  }

  if (statusCounts.patched === scan.patchStates.length) {
    return {
      ok: true,
      outcome: "already patched",
      extensionRoot: scan.extensionRoot,
      targetReports: scan.targetReports,
      patchStates: scan.patchStates,
      dryRun: false,
      changed: false,
      backupDir: null,
      message: "All patch anchors are already patched.",
    };
  }

  if (statusCounts.original === scan.patchStates.length) {
    const report = applyPatches({ ...options, dryRun: false });
    return {
      ...report,
      outcome: report.ok && report.changed ? "repaired" : "already patched",
      message:
        report.ok && report.changed
          ? "Repair completed. Backup created and patch applied."
          : report.message,
    };
  }

  return {
    ok: false,
    outcome: "mixed state",
    extensionRoot: scan.extensionRoot,
    targetReports: scan.targetReports,
    patchStates: scan.patchStates,
    dryRun: false,
    changed: false,
    backupDir: null,
    message: "Patch anchors are in a mixed state. No automatic repair was attempted.",
  };
}

function countPatchStatuses(patchStates) {
  return patchStates.reduce(
    (counts, state) => {
      counts[state.status] = (counts[state.status] || 0) + 1;
      return counts;
    },
    { original: 0, patched: 0, missing: 0 }
  );
}

function restoreLatestBackup(options) {
  const extensionRoot = resolveExtensionRoot(options);
  const backupRoot = resolveBackupRoot(extensionRoot, options);

  if (!fs.existsSync(backupRoot)) {
    return {
      ok: false,
      extensionRoot,
      restoredFiles: [],
      message: `No backup root found at ${backupRoot}`,
    };
  }

  const candidates = fs
    .readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const candidate of candidates) {
    const manifestPath = path.join(backupRoot, candidate, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      continue;
    }

    const manifest = JSON.parse(readUtf8(manifestPath));
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
      continue;
    }

    const restoredFiles = [];

    for (const file of manifest.files) {
      const backupFile = path.join(backupRoot, candidate, file.backupRelativePath);
      const targetFile = path.join(extensionRoot, file.targetRelativePath);

      if (!fs.existsSync(backupFile)) {
        throw new Error(`Backup file missing: ${backupFile}`);
      }

      fs.mkdirSync(path.dirname(targetFile), { recursive: true });
      fs.copyFileSync(backupFile, targetFile);
      restoredFiles.push(targetFile);
    }

    return {
      ok: true,
      extensionRoot,
      restoredFiles,
      message: "Restored latest backup.",
    };
  }

  return {
    ok: false,
    extensionRoot,
    restoredFiles: [],
    message: "No matching backup was found.",
  };
}

function buildTargetReports(extensionRoot, contentsOverride = new Map()) {
  const targetMap = new Map();

  for (const patch of PATCHES) {
    const list = targetMap.get(patch.targetRelativePath) || [];
    list.push(patch);
    targetMap.set(patch.targetRelativePath, list);
  }

  return Array.from(targetMap.entries()).map(([targetRelativePath, patches]) => {
    const targetFile = path.join(extensionRoot, targetRelativePath);
    const contents = contentsOverride.get(targetFile) ?? readUtf8(targetFile);

    return {
      targetRelativePath,
      targetFile,
      contents,
      patches,
      patchStates: patches.map((patch) => evaluatePatch(contents, patch)),
    };
  });
}

function createBackup(extensionRoot, changedFiles, options) {
  const backupRoot = resolveBackupRoot(extensionRoot, options);
  fs.mkdirSync(backupRoot, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(backupRoot, stamp);
  fs.mkdirSync(backupDir, { recursive: true });

  const manifest = {
    patchId: PATCH_ID,
    createdAt: new Date().toISOString(),
    extensionRoot,
    files: [],
  };

  for (const file of changedFiles) {
    const backupRelativePath = path.join("files", file.relativePath);
    const backupFile = path.join(backupDir, backupRelativePath);
    fs.mkdirSync(path.dirname(backupFile), { recursive: true });
    fs.writeFileSync(backupFile, file.originalContents, "utf8");
    manifest.files.push({
      targetRelativePath: file.relativePath,
      backupRelativePath,
    });
  }

  fs.writeFileSync(
    path.join(backupDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  return backupDir;
}

function resolveExtensionRoot(options) {
  if (options.extensionRoot) {
    const resolved = path.resolve(options.extensionRoot);
    assertExists(resolved, "extension root");
    return resolved;
  }

  const baseDir =
    options.vscodeExtensionsDir ||
    path.join(process.env.USERPROFILE || process.env.HOME || "", ".vscode", "extensions");

  assertExists(baseDir, "VS Code extensions directory");

  const matches = fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(OPENAI_EXTENSION_PREFIX))
    .map((entry) => entry.name)
    .sort(compareExtensionVersions)
    .reverse();

  if (matches.length === 0) {
    throw new Error(`No installed extension matched ${OPENAI_EXTENSION_PREFIX}* under ${baseDir}`);
  }

  return path.join(baseDir, matches[0]);
}

function compareExtensionVersions(left, right) {
  const leftVersion = left.slice(OPENAI_EXTENSION_PREFIX.length).split("-")[0];
  const rightVersion = right.slice(OPENAI_EXTENSION_PREFIX.length).split("-")[0];
  return compareDottedVersions(leftVersion, rightVersion);
}

function compareDottedVersions(left, right) {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

function resolveBackupRoot(extensionRoot, options) {
  if (options.backupRoot) {
    return path.resolve(options.backupRoot);
  }
  return path.join(extensionRoot, BACKUP_ROOT_NAME);
}

function evaluatePatch(contents, patch) {
  if (contents.includes(patch.replace)) {
    return {
      id: patch.id,
      description: patch.description,
      targetRelativePath: patch.targetRelativePath,
      status: "patched",
    };
  }

  if (contents.includes(patch.find)) {
    return {
      id: patch.id,
      description: patch.description,
      targetRelativePath: patch.targetRelativePath,
      status: "original",
    };
  }

  return {
    id: patch.id,
    description: patch.description,
    targetRelativePath: patch.targetRelativePath,
    status: "missing",
  };
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function assertExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Missing ${label}: ${targetPath}`);
  }
}

function printReport(report) {
  const alreadyPatched =
    typeof report.alreadyPatched === "boolean"
      ? report.alreadyPatched
      : report.patchStates.every((state) => state.status === "patched");

  console.log(`[${PATCH_ID}] extension root: ${report.extensionRoot}`);
  console.log(`[${PATCH_ID}] already patched: ${alreadyPatched ? "yes" : "no"}`);

  for (const targetReport of report.targetReports) {
    console.log(`[${PATCH_ID}] target file: ${targetReport.targetFile}`);
    for (const state of targetReport.patchStates) {
      console.log(`[${PATCH_ID}] ${state.id}: ${state.status}`);
    }
  }
}

function printApplyReport(report) {
  printReport(report);
  console.log(`[${PATCH_ID}] dry run: ${report.dryRun ? "yes" : "no"}`);
  console.log(`[${PATCH_ID}] changed: ${report.changed ? "yes" : "no"}`);
  if (report.backupDir) {
    console.log(`[${PATCH_ID}] backup: ${report.backupDir}`);
  }
  console.log(`[${PATCH_ID}] ${report.message}`);
}

function printRepairReport(report) {
  printReport(report);
  console.log(`[${PATCH_ID}] outcome: ${report.outcome}`);
  console.log(`[${PATCH_ID}] changed: ${report.changed ? "yes" : "no"}`);
  if (report.backupDir) {
    console.log(`[${PATCH_ID}] backup: ${report.backupDir}`);
  }
  console.log(`[${PATCH_ID}] ${report.message}`);
}

function printRestoreReport(report) {
  console.log(`[${PATCH_ID}] extension root: ${report.extensionRoot}`);
  for (const file of report.restoredFiles) {
    console.log(`[${PATCH_ID}] restored: ${file}`);
  }
  console.log(`[${PATCH_ID}] ${report.message}`);
}

main();
