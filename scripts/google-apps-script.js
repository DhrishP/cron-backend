/**
 * Google Apps Script for Spends Tracker
 * Receives transaction data from the cron-backend webhook and logs it to the sheet.
 *
 * Sheet columns (in order):
 *   A: Date
 *   B: Title
 *   C: Type        (Debit / Credit / ATM / Cash / Amortized)
 *   D: Amount (₹)
 *   E: Tag          (Normal / Amortized (N mo) / Emergency)
 *   F: Effective Monthly (₹)
 *   G: Raw SMS
 *
 * Deploy as: Web App → Execute as Me → Access: Anyone
 */

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);

    // 1. Handle monthly summary request
    if (data.action === 'get_monthly_summary') {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success', summary: getMonthlySummary(sheet) }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 2. Handle dynamic amortization / tag update from Telegram callback
    if (data.action === 'update_tag' && data.row) {
      var row = parseInt(data.row, 10);
      var duration = parseInt(data.duration, 10) || 1;
      var tag = data.tag || 'Amortized';

      var amount = parseFloat(sheet.getRange(row, 4).getValue()) || 0; // Column D = Amount
      var origTitle = (sheet.getRange(row, 2).getValue() || '').toString(); // Column B = Title
      var origDateVal = sheet.getRange(row, 1).getValue(); // Column A = Date

      // Clean title from previous tag suffixes if any
      var baseTitle = origTitle.replace(/\s*\(\d+\/\d+\)/g, '').trim();

      if (duration > 1) {
        var effective = Math.round((amount / duration) * 100) / 100;
        var tagLabel = 'Amortized (' + duration + 'mo)';

        // Update Month 1 row
        sheet.getRange(row, 2).setValue(baseTitle + ' (1/' + duration + ')');
        sheet.getRange(row, 5).setValue(tagLabel);
        sheet.getRange(row, 6).setValue(effective);

        // Parse base date
        var origDate = parseDateValue(origDateVal);

        // Generate future rows for months 2 .. duration
        var futureRows = [];
        for (var m = 2; m <= duration; m++) {
          var futureDate = new Date(origDate.getFullYear(), origDate.getMonth() + (m - 1), origDate.getDate());
          var formattedFutureDate = formatDate(futureDate);
          var futureTitle = baseTitle + ' (' + m + '/' + duration + ')';
          var futureType = 'Amortized';
          var futureAmount = 0; // Bank debit is 0 because entire amount was debited in Month 1
          var futureTag = tagLabel;
          var futureEffective = effective;
          var futureRaw = 'Auto-amortized (Month ' + m + '/' + duration + ' of Row ' + row + ')';

          futureRows.push([formattedFutureDate, futureTitle, futureType, futureAmount, futureTag, futureEffective, futureRaw]);
        }

        if (futureRows.length > 0) {
          var startRow = sheet.getLastRow() + 1;
          sheet.getRange(startRow, 1, futureRows.length, 7).setValues(futureRows);
        }

        return ContentService
          .createTextOutput(JSON.stringify({
            status: 'success',
            row: row,
            tag: tagLabel,
            duration: duration,
            monthlyCost: effective,
            createdRows: futureRows.length
          }))
          .setMimeType(ContentService.MimeType.JSON);

      } else if (tag === 'Emergency') {
        sheet.getRange(row, 5).setValue('Emergency');
        sheet.getRange(row, 6).setValue(0);
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'success', row: row, tag: 'Emergency', effective: 0 }))
          .setMimeType(ContentService.MimeType.JSON);

      } else {
        sheet.getRange(row, 5).setValue(tag || 'Normal');
        sheet.getRange(row, 6).setValue(amount);
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'success', row: row, tag: tag || 'Normal', effective: amount }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    // 3. Normal transaction logging
    var date, title, type, amount, tag, effectiveMonthly, raw;

    if (data.date && data.title) {
      date    = data.date;
      title   = data.title || '';
      type    = data.type || 'Debit';
      amount  = data.amount || 0;
      tag     = data.tag || 'Normal';
      effectiveMonthly = data.effectiveMonthly != null ? data.effectiveMonthly : amount;
      raw     = data.raw || '';
    } else if (data.parsed) {
      var p   = data.parsed;
      date    = new Date().toLocaleDateString('en-IN');
      title   = p.title || '';
      type    = p.type || 'Debit';
      amount  = p.amount || 0;
      tag     = p.suggestedTag || 'Normal';
      effectiveMonthly = p.effectiveMonthlyCost != null ? p.effectiveMonthlyCost : amount;
      raw     = data.sms || p.rawSms || '';
    } else {
      date    = new Date().toLocaleDateString('en-IN');
      title   = data.title || 'Unknown';
      type    = data.type || 'Debit';
      amount  = data.amount || 0;
      tag     = 'Normal';
      effectiveMonthly = amount;
      raw     = JSON.stringify(data);
    }

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

function parseDateValue(val) {
  if (val instanceof Date) return val;
  if (!val) return new Date();

  var s = val.toString().trim();
  // Match DD/MM/YYYY or DD-MM-YYYY
  var parts = s.split(/[\/\-\.]/);
  if (parts.length === 3) {
    var day = parseInt(parts[0], 10);
    var month = parseInt(parts[1], 10) - 1;
    var year = parseInt(parts[2], 10);
    if (year < 100) year += 2000;
    return new Date(year, month, day);
  }

  var d = new Date(s);
  return isNaN(d.getTime()) ? new Date() : d;
}

function formatDate(date) {
  var d = date.getDate();
  var m = date.getMonth() + 1;
  var y = date.getFullYear();
  return (d < 10 ? '0' + d : d) + '/' + (m < 10 ? '0' + m : m) + '/' + y;
}

function getMonthlySummary(sheet) {
  var now = new Date();
  var currentMonth = now.getMonth();
  var currentYear = now.getFullYear();
  var data = sheet.getDataRange().getValues();

  var totalDebited = 0, totalCredited = 0;
  var normalSpends = 0, amortizedSpends = 0, emergencySpends = 0;
  var effectiveMonthlyBurn = 0;
  var count = 0;

  for (var i = 1; i < data.length; i++) {
    var rowDate = parseDateValue(data[i][0]);
    if (rowDate.getMonth() === currentMonth && rowDate.getFullYear() === currentYear) {
      var type   = (data[i][2] || '').toString();
      var amount = parseFloat(data[i][3]) || 0;
      var tag    = (data[i][4] || 'Normal').toString();
      var eff    = parseFloat(data[i][5]) || 0;

      if (type === 'Credit') {
        totalCredited += amount;
      } else {
        totalDebited += amount;
        if (tag.indexOf('Amortized') !== -1 || tag === 'Yearly' || tag === 'Quarterly') {
          amortizedSpends += eff;
        } else if (tag === 'Emergency') {
          emergencySpends += amount;
        } else {
          normalSpends += amount;
        }
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
    yearlyAmortized: amortizedSpends,
    quarterlyAmortized: 0,
    emergencySpends: emergencySpends,
    transactionCount: count
  };
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'Spends Tracker API is active' }))
    .setMimeType(ContentService.MimeType.JSON);
}
