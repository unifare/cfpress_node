/**
 * Extension upload — shared by the Themes and Plugins screens.
 *
 * Both screens post a ZIP to the same endpoint shape, so this lives in its own
 * module rather than making one screen depend on the other.
 */
import { api } from "../state.js";
import { render } from "../shell.js";
import { t } from "../i18n.js";
import { alertDialog, toast } from "../../ui.js";

export function formatReportDiagnostics(report) {
  if (!report || !Array.isArray(report.diagnostics) || !report.diagnostics.length) return "";
  return report.diagnostics
    .map((d) => {
      const icon = d.level === "error" ? "❌" : d.level === "warning" ? "⚠️" : "ℹ️";
      let text = `${icon} [${d.code}] ${d.message}`;
      if (d.file) text += ` (${d.file})`;
      if (d.suggestion) text += `\n   👉 ${t("core.ext.suggestion", "Suggestion")}: ${d.suggestion}`;
      return text;
    })
    .join("\n\n");
}

export async function installExtension(file, type) {
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  try {
    const d = await api(`extensions/${type}/upload`, { method: "POST", body: fd });
    let msg = t("core.ext.installed", "Installed {name} {version}", { name: d.name, version: d.version });
    if (d.report && typeof d.report.score === "number") {
      msg += ` (${t("core.ext.healthScore", "Health score: {score}/100", { score: d.report.score })})`;
    }
    toast(msg);

    if (d.report && d.report.summary && d.report.summary.warnings > 0) {
      await alertDialog({
        title: t("core.ext.inspectionWarnings", "Package Inspection Warnings"),
        description: `${t("core.ext.installedWithWarnings", "Installed successfully, but found {n} warnings:", { n: d.report.summary.warnings })}\n\n${formatReportDiagnostics(d.report)}`,
      });
    }

    render();
  } catch (e) {
    const reportDesc = formatReportDiagnostics(e.report);
    const desc = reportDesc
      ? `${e.message}\n\n${t("core.ext.inspectionDetails", "Inspection Details:")}\n${reportDesc}`
      : e.message;
    await alertDialog({
      title: t("core.ext.installFailed", "Install failed"),
      description: desc,
    });
  }
}
