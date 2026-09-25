/**
 * Google Apps Script for Spends Tracker
 * Receives transaction data from the cron-backend webhook and logs it to the sheet.
 *
 * Sheet columns (in order):
 *   A: Date
 *   B: Title
 *   C: Type        (Debit / Credit / ATM / Cash)
 *   D: Amount (₹)
 *   E: Tag          (Normal / Yearly / Emergency)
 *   F: Effective Monthly (₹)
 *   G: Raw SMS
 *
 * Deploy as: Web App → Execute as Me → Access: Anyone
 */

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);

    // Handle monthly summary request
    if (data.action === 'get_monthly_summary') {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success', summary: getMonthlySummary(sheet) }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Handle tag update from Telegram callback
    if (data.action === 'update_tag' && data.row && data.tag) {
      var row = parseInt(data.row);
      sheet.getRange(row, 5).setValue(data.tag); // Column E = Tag

      // Recalculate effective monthly based on new tag
      var amount = sheet.getRange(row, 4).getValue(); // Column D = Amount
      var effective = amount;
      if (data.tag === 'Yearly') effective = Math.round((amount / 12) * 100) / 100;
      else if (data.tag === 'Emergency') effective = 0;
      sheet.getRange(row, 6).setValue(effective); // Column F = Effective Monthly

      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success', row: row, tag: data.tag }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // --- Normal transaction logging ---

    // Accept FLAT format from backend:
    //   { date, title, type, amount, tag, effectiveMonthly, raw }
    // Also accept LEGACY nested format:
    //   { sms, sender, parsed: { title, type, amount, suggestedTag, effectiveMonthlyCost, ... } }

    var date, title, type, amount, tag, effectiveMonthly, raw;

    if (data.date && data.title) {
      // New flat format
      date    = data.date;
      title   = data.title || '';
      type    = data.type || 'Debit';
      amount  = data.amount || 0;
      tag     = data.tag || 'Normal';
      effectiveMonthly = data.effectiveMonthly != null ? data.effectiveMonthly : amount;
      raw     = data.raw || '';
    } else if (data.parsed) {
      // Legacy nested format
      var p   = data.parsed;
      date    = new Date().toLocaleDateString('en-IN');
      title   = p.title || '';
      type    = p.type || 'Debit';
      amount  = p.amount || 0;
      tag     = p.suggestedTag || 'Normal';
      effectiveMonthly = p.effectiveMonthlyCost != null ? p.effectiveMonthlyCost : amount;
      raw     = data.sms || p.rawSms || '';
    } else {
      // Fallback: just dump whatever we got
      date    = new Date().toLocaleDateString('en-IN');
      title   = data.title || 'Unknown';
      type    = data.type || 'Debit';
      amount  = data.amount || 0;
      tag     = 'Normal';
      effectiveMonthly = amount;
      raw     = JSON.stringify(data);
    }

    // Append row: Date | Title | Type | Amount | Tag | Effective Monthly | Raw
    sheet.appendRow([date, title, type, amount, tag, effectiveMonthly, raw]);
    var lastRow = sheet.getLastRow();

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', row: lastRow }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getMonthlySummary(sheet) {
  var now = new Date();
  var currentMonth = now.getMonth();
  var currentYear = now.getFullYear();
  var data = sheet.getDataRange().getValues();

  var totalDebited = 0, totalCredited = 0;
  var normalSpends = 0, yearlyAmortized = 0, quarterlyAmortized = 0, emergencySpends = 0;
  var effectiveMonthlyBurn = 0;
  var count = 0;

  for (var i = 1; i < data.length; i++) {
    var rowDate = new Date(data[i][0]);
    if (rowDate.getMonth() === currentMonth && rowDate.getFullYear() === currentYear) {
      var type   = (data[i][2] || '').toString();
      var amount = parseFloat(data[i][3]) || 0;
      var tag    = (data[i][4] || 'Normal').toString();
      var eff    = parseFloat(data[i][5]) || 0;

      if (type === 'Credit') {
        totalCredited += amount;
      } else {
        totalDebited += amount;
        if (tag === 'Yearly')         yearlyAmortized += eff;
        else if (tag === 'Quarterly') quarterlyAmortized += eff;
        else if (tag === 'Emergency') emergencySpends += amount;
        else                          normalSpends += amount;
      }
      effectiveMonthlyBurn += eff;
      count++;
    }
  }

  return {
    period: now.toLocaleString('default', { month: 'long', year: 'numeric' }),
    totalDebited: totalDebited,
    totalCredited: totalCredited,
    effectiveMonthlyBurn: effectiveMonthlyBurn,
    normalSpends: normalSpends,
    yearlyAmortized: yearlyAmortized,
    quarterlyAmortized: quarterlyAmortized,
    emergencySpends: emergencySpends,
    transactionCount: count
  };
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'Spends Tracker API is active' }))
    .setMimeType(ContentService.MimeType.JSON);
}
