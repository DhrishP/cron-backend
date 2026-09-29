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

    // 1. Handle fetching recent transactions for deduplication
    if (data.action === 'get_recent') {
      var limit = parseInt(data.limit, 10) || 5;
      var lastRow = sheet.getLastRow();
      var startRow = Math.max(2, lastRow - limit + 1);
      var count = lastRow - startRow + 1;
      var recent = [];
      if (count > 0 && lastRow >= 2) {
        var rows = sheet.getRange(startRow, 1, count, 7).getValues();
        for (var i = rows.length - 1; i >= 0; i--) {
          recent.push({
            date: rows[i][0],
            title: (rows[i][1] || '').toString(),
            type: (rows[i][2] || '').toString(),
            amount: parseFloat(rows[i][3]) || 0,
            tag: (rows[i][4] || '').toString(),
            effective: parseFloat(rows[i][5]) || 0,
            raw: (rows[i][6] || '').toString()
          });
        }
      }
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success', transactions: recent }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 2. Handle monthly summary request
    if (data.action === 'get_monthly_summary') {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success', summary: getMonthlySummary(sheet) }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 3. Handle dynamic amortization / split from Telegram callback
    if (data.action === 'update_tag') {
      var row = parseInt(data.row, 10);
      var duration = parseInt(data.duration, 10) || 1;
      var tag = data.tag || 'Amortized';

      var allData = sheet.getDataRange().getValues();
      var lastRow = sheet.getLastRow();

      var targetRow = row;
      var currentAmount = 0;

      if (targetRow >= 2 && targetRow <= lastRow) {
        currentAmount = parseFloat(sheet.getRange(targetRow, 4).getValue()) || 0;
      }

      // If targetRow has 0 amount (e.g. user clicked on a future row or index was offset),
      // auto-find the latest real transaction that has amount > 0
      if (currentAmount <= 0) {
        for (var r = allData.length - 1; r >= 1; r--) {
          var amt = parseFloat(allData[r][3]) || 0;
          var t = (allData[r][2] || '').toString();
          if (amt > 0 && t !== 'Amortized') {
            targetRow = r + 1; // 1-indexed row number
            currentAmount = amt;
            break;
          }
        }
      }

      var origTitle = (sheet.getRange(targetRow, 2).getValue() || '').toString();
      var origDateVal = sheet.getRange(targetRow, 1).getValue();
      currentAmount = parseFloat(sheet.getRange(targetRow, 4).getValue()) || currentAmount;

      // Clean title from previous suffix like " (1/3)"
      var baseTitle = origTitle.replace(/\s*\(\d+\/\d+\)/g, '').trim();

      if (duration > 1 && currentAmount > 0) {
        // Split amount evenly across all duration months
        var splitAmount = Math.round((currentAmount / duration) * 100) / 100;
        var tagLabel = 'Amortized (' + duration + 'mo)';

        // 1. Update Month 1 row (Original row)
        sheet.getRange(targetRow, 2).setValue(baseTitle + ' (1/' + duration + ')');
        sheet.getRange(targetRow, 4).setValue(splitAmount); // Amount = split amount
        sheet.getRange(targetRow, 5).setValue(tagLabel);
        sheet.getRange(targetRow, 6).setValue(splitAmount); // Effective Monthly = split amount

        // Parse base date
        var origDate = parseDateValue(origDateVal);

        // 2. Generate exactly (duration - 1) future rows for months 2 to duration
        var futureRows = [];
        for (var m = 2; m <= duration; m++) {
          var targetYear = origDate.getFullYear();
          var targetMonth = origDate.getMonth() + (m - 1);
          // Month overflow handling: clamp targetDay to max days in targetMonth (e.g. Jan 31 -> Feb 28, not March 3)
          var daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
          var targetDay = Math.min(origDate.getDate(), daysInTargetMonth);
          var futureDate = new Date(targetYear, targetMonth, targetDay);

          var formattedFutureDate = formatDate(futureDate);
          var futureTitle = baseTitle + ' (' + m + '/' + duration + ')';
          var futureType = 'Amortized';
          var futureAmount = splitAmount; // Split amount (not 0!)
          var futureTag = tagLabel;
          var futureEffective = splitAmount;
          var futureRaw = 'Split ' + m + '/' + duration + ' of ' + baseTitle + ' (₹' + currentAmount + ' total)';

          futureRows.push([formattedFutureDate, futureTitle, futureType, futureAmount, futureTag, futureEffective, futureRaw]);
        }

        if (futureRows.length > 0) {
          var appendStart = sheet.getLastRow() + 1;
          sheet.getRange(appendStart, 1, futureRows.length, 7).setValues(futureRows);
        }

        // Always keep sheet sorted chronologically by Date
        sortSheetByDate(sheet);

        return ContentService
          .createTextOutput(JSON.stringify({
            status: 'success',
            row: targetRow,
            tag: tagLabel,
            duration: duration,
            totalAmount: currentAmount,
            monthlyCost: splitAmount,
            createdRows: futureRows.length
          }))
          .setMimeType(ContentService.MimeType.JSON);

      } else if (tag === 'Emergency') {
        sheet.getRange(targetRow, 5).setValue('Emergency');
        sheet.getRange(targetRow, 6).setValue(0);
        sortSheetByDate(sheet);
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'success', row: targetRow, tag: 'Emergency', effective: 0 }))
          .setMimeType(ContentService.MimeType.JSON);

      } else {
        sheet.getRange(targetRow, 5).setValue(tag || 'Normal');
        sheet.getRange(targetRow, 6).setValue(currentAmount);
        sortSheetByDate(sheet);
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'success', row: targetRow, tag: tag || 'Normal', effective: currentAmount }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    // 4. Handle cleaning up zombie 0 rows
    if (data.action === 'clean_zombie_rows') {
      var deleted = cleanZombieRows(sheet);
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success', deletedRows: deleted }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // SAFETY GUARD: If ANY other action is present, NEVER fall through to row logging!
    if (data.action) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'error', message: 'Unrecognized action: ' + data.action }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 5. Normal transaction logging
    var date, title, type, amount, tag, effectiveMonthly, raw;

    if (data.date && data.title) {
      date    = data.date;
      title   = data.title || '';
      type    = data.type || 'Debit';
      amount  = parseFloat(data.amount) || 0;
      tag     = data.tag || 'Normal';
      effectiveMonthly = data.effectiveMonthly != null ? parseFloat(data.effectiveMonthly) : amount;
      raw     = data.raw || '';
    } else if (data.parsed) {
      var p   = data.parsed;
      date    = new Date().toLocaleDateString('en-IN');
      title   = p.title || '';
      type    = p.type || 'Debit';
      amount  = parseFloat(p.amount) || 0;
      tag     = p.suggestedTag || 'Normal';
      effectiveMonthly = p.effectiveMonthlyCost != null ? parseFloat(p.effectiveMonthlyCost) : amount;
      raw     = data.sms || p.rawSms || '';
    } else {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'ignored', message: 'Missing transaction data' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // STRICT GUARD: Never append a row if amount is zero or title is missing!
    if (amount <= 0 || !title || title === 'Unknown') {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'ignored', message: 'Amount is 0 or invalid title, skipped' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    sheet.appendRow([date, title, type, amount, tag, effectiveMonthly, raw]);
    var insertedRow = sheet.getLastRow();

    // Always sort sheet chronologically by Date
    sortSheetByDate(sheet);

    // Find the exact row index of the transaction after sorting
    var afterSortData = sheet.getDataRange().getValues();
    var finalRow = insertedRow;
    for (var i = afterSortData.length - 1; i >= 1; i--) {
      if (afterSortData[i][1] === title && afterSortData[i][6] === raw) {
        finalRow = i + 1;
        break;
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', row: finalRow }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Sorts all data rows (Row 2 to lastRow) chronologically by Date (Column A).
 * Handles DD/MM/YYYY, DD-MM-YYYY, or Native Date objects.
 */
function sortSheetByDate(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 2) return; // Only 0 or 1 data row

  var numColumns = Math.max(sheet.getLastColumn(), 7);
  var range = sheet.getRange(2, 1, lastRow - 1, numColumns);
  var values = range.getValues();

  values.sort(function(a, b) {
    var timeA = parseDateValue(a[0]).getTime();
    var timeB = parseDateValue(b[0]).getTime();
    return timeA - timeB;
  });

  range.setValues(values);
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

      // Exclude Credit Card bill payments and self-transfers from Burn, Given, and Taken
      if (type === 'Transfer' || tag === 'Transfer') {
        count++;
        continue;
      }

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
        effectiveMonthlyBurn += eff;
      }
      count++;
    }
  }

  var netCashFlow = totalCredited - totalDebited;

  return {
    period: now.toLocaleString('default', { month: 'long', year: 'numeric' }),
    totalDebited: totalDebited,
    totalCredited: totalCredited,
    netCashFlow: netCashFlow,
    effectiveMonthlyBurn: effectiveMonthlyBurn,
    normalSpends: normalSpends,
    yearlyAmortized: amortizedSpends,
    quarterlyAmortized: 0,
    emergencySpends: emergencySpends,
    transactionCount: count
  };
}

function doGet(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  // Safe read-only query for recent transactions (cannot insert rows)
  if (e && e.parameter && e.parameter.action === 'get_recent') {
    var limit = parseInt(e.parameter.limit, 10) || 5;
    var lastRow = sheet.getLastRow();
    var startRow = Math.max(2, lastRow - limit + 1);
    var count = lastRow - startRow + 1;
    var recent = [];
    if (count > 0 && lastRow >= 2) {
      var rows = sheet.getRange(startRow, 1, count, 7).getValues();
      for (var i = rows.length - 1; i >= 0; i--) {
        recent.push({
          date: rows[i][0],
          title: (rows[i][1] || '').toString(),
          type: (rows[i][2] || '').toString(),
          amount: parseFloat(rows[i][3]) || 0,
          tag: (rows[i][4] || '').toString(),
          effective: parseFloat(rows[i][5]) || 0,
          raw: (rows[i][6] || '').toString()
        });
      }
    }
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', transactions: recent }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    sortSheetByDate(sheet);
  } catch (err) {}

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'Spends Tracker API is active' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Utility to clean up accidental zero-amount or payload rows.
 * Can be run directly from the Apps Script editor toolbar (select 'cleanZombieRows' -> click Run).
 */
function cleanZombieRows(targetSheet) {
  var sheet = targetSheet || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  var count = 0;

  for (var i = data.length - 1; i >= 1; i--) {
    var amt = parseFloat(data[i][3]) || 0;
    var title = (data[i][1] || '').toString();
    var raw = (data[i][6] || '').toString();

    // Check if this row is an accidental/zombie payload or 0 amount log
    if (amt <= 0 && (raw.indexOf('get_recent') !== -1 || raw.indexOf('action') !== -1 || title === 'Unknown' || title === '')) {
      sheet.deleteRow(i + 1);
      count++;
    }
  }

  Logger.log('Cleaned up ' + count + ' zombie rows.');
  return count;
}

