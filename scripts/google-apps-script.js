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

    // 5. Handle populating old subscriptions
    if (data.action === 'populate_old_subscriptions') {
      populateOldSubscriptions();
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success', message: 'Populated old subscriptions and sorted sheet.' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 6. Handle subscription renewals inquiry
    if (data.action === 'get_renewals' || data.action === 'get_subscriptions') {
      var daysAhead = parseInt(data.days, 10) || 45;
      var renewals = getSubscriptionRenewals(sheet, daysAhead);
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success', renewals: renewals }))
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

  var actualCashDebited = 0;
  var totalCredited = 0;
  var normalSpends = 0;
  var amortizedSpends = 0;
  var emergencySpends = 0;
  var effectiveMonthlyBurn = 0;
  var count = 0;

  for (var i = 1; i < data.length; i++) {
    var rowDate = parseDateValue(data[i][0]);
    if (rowDate.getMonth() === currentMonth && rowDate.getFullYear() === currentYear) {
      var title  = (data[i][1] || '').toString();
      var type   = (data[i][2] || '').toString();
      var amount = parseFloat(data[i][3]) || 0;
      var tag    = (data[i][4] || 'Normal').toString();
      var eff    = parseFloat(data[i][5]) || 0;
      var raw    = (data[i][6] || '').toString();

      // Exclude transfers and credit card bill payments from all metrics
      if (type === 'Transfer' || tag === 'Transfer') {
        count++;
        continue;
      }

      var isAmortizedOrSub = (
        type === 'Amortized' ||
        tag.indexOf('Amortized') !== -1 ||
        tag === 'Yearly' ||
        tag === 'Quarterly' ||
        tag === 'Subscription' ||
        title.indexOf('GST Filing') !== -1 ||
        title.indexOf('YouTube Premium') !== -1 ||
        raw.indexOf('Split ') !== -1 ||
        raw.indexOf('Monthly ') !== -1
      );

      if (type === 'Credit') {
        totalCredited += amount;
      } else if (isAmortizedOrSub) {
        // Amortized subscription slice:
        // Does NOT debit actual bank cash this month (already pre-paid or recurring commitment)!
        var monthlySlice = eff > 0 ? eff : amount;
        amortizedSpends += monthlySlice;
        effectiveMonthlyBurn += monthlySlice;
      } else if (tag === 'Emergency') {
        actualCashDebited += amount;
        emergencySpends += amount;
      } else {
        // Real everyday debit/spend
        actualCashDebited += amount;
        normalSpends += amount;
        effectiveMonthlyBurn += amount;
      }
      count++;
    }
  }

  var netCashFlow = totalCredited - actualCashDebited;

  return {
    period: now.toLocaleString('default', { month: 'long', year: 'numeric' }),
    totalDebited: Math.round(actualCashDebited * 100) / 100,
    totalCredited: Math.round(totalCredited * 100) / 100,
    netCashFlow: Math.round(netCashFlow * 100) / 100,
    effectiveMonthlyBurn: Math.round(effectiveMonthlyBurn * 100) / 100,
    normalSpends: Math.round(normalSpends * 100) / 100,
    yearlyAmortized: Math.round(amortizedSpends * 100) / 100,
    quarterlyAmortized: 0,
    emergencySpends: Math.round(emergencySpends * 100) / 100,
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

  // Safe read-only query for subscription renewals
  if (e && e.parameter && (e.parameter.action === 'get_renewals' || e.parameter.action === 'get_subscriptions')) {
    var daysAhead = parseInt(e.parameter.days, 10) || 45;
    var renewals = getSubscriptionRenewals(sheet, daysAhead);
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', renewals: renewals }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Safe read-only query for monthly summary
  if (e && e.parameter && e.parameter.action === 'get_monthly_summary') {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', summary: getMonthlySummary(sheet) }))
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

/**
 * Helper to populate old recurring subscriptions in splits.
 * Can be run directly from Apps Script editor toolbar:
 * Select 'populateOldSubscriptions' from dropdown -> click '▷ Run'.
 */
function populateOldSubscriptions() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  // 1. First clean up any accidental 0 zombie rows
  var cleaned = cleanZombieRows(sheet);
  Logger.log('Cleaned up ' + cleaned + ' zombie rows before populating.');

  var existingData = sheet.getDataRange().getValues();
  var existingTitles = {};
  for (var r = 1; r < existingData.length; r++) {
    existingTitles[(existingData[r][1] || '').toString()] = true;
  }

  var rowsToAdd = [];

  function addAmortizedSplit(baseTitle, totalAmount, durationMonths, startDay, startMonth, startYear) {
    var splitAmount = Math.round((totalAmount / durationMonths) * 100) / 100;
    var tagLabel = 'Amortized (' + durationMonths + 'mo)';

    for (var m = 1; m <= durationMonths; m++) {
      var fullTitle = baseTitle + ' (' + m + '/' + durationMonths + ')';

      // Avoid duplicating if already present
      if (existingTitles[fullTitle]) {
        Logger.log('Skipping existing: ' + fullTitle);
        continue;
      }

      var targetYear = startYear;
      var targetMonth = (startMonth - 1) + (m - 1);
      var daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
      var targetDay = Math.min(startDay, daysInTargetMonth);
      var futureDate = new Date(targetYear, targetMonth, targetDay);

      var formattedDate = formatDate(futureDate);
      var type = 'Amortized';
      var amount = splitAmount;
      var tag = tagLabel;
      var effective = splitAmount;
      var raw = 'Split ' + m + '/' + durationMonths + ' of ' + baseTitle + ' (₹' + totalAmount + ' total)';

      rowsToAdd.push([formattedDate, fullTitle, type, amount, tag, effective, raw]);
    }
  }

  // Helper to add monthly recurring expenses (e.g. monthly GST filing)
  function addMonthlyRecurring(baseTitle, monthlyAmount, countMonths, startDay, startMonth, startYear) {
    for (var m = 1; m <= countMonths; m++) {
      var targetYear = startYear;
      var targetMonth = (startMonth - 1) + (m - 1);
      var daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
      var targetDay = Math.min(startDay, daysInTargetMonth);
      var dateObj = new Date(targetYear, targetMonth, targetDay);

      var formattedDate = formatDate(dateObj);
      var monthYearLabel = dateObj.toLocaleString('default', { month: 'short', year: 'numeric' });
      var fullTitle = baseTitle + ' (' + monthYearLabel + ')';

      if (existingTitles[fullTitle]) {
        Logger.log('Skipping existing: ' + fullTitle);
        continue;
      }

      var type = 'Amortized';
      var amount = monthlyAmount;
      var tag = 'Amortized (Monthly)';
      var effective = monthlyAmount;
      var raw = 'Monthly ' + baseTitle + ' for ' + monthYearLabel;

      rowsToAdd.push([formattedDate, fullTitle, type, amount, tag, effective, raw]);
    }
  }

  // Repair any existing historical subscription rows in the sheet so Type = 'Amortized'
  var updatedRows = 0;
  for (var r = 1; r < existingData.length; r++) {
    var rTitle = (existingData[r][1] || '').toString();
    var rRaw = (existingData[r][6] || '').toString();
    var rType = (existingData[r][2] || '').toString();
    var isSub = (
      rRaw.indexOf('Split ') !== -1 ||
      rRaw.indexOf('Monthly ') !== -1 ||
      rTitle.indexOf('GST Filing') !== -1 ||
      rTitle.indexOf('YouTube Premium') !== -1 ||
      rTitle.indexOf('(1/3)') !== -1 ||
      rTitle.indexOf('(1/12)') !== -1 ||
      rTitle.indexOf('(1/6)') !== -1
    );
    if (isSub && rType !== 'Amortized') {
      sheet.getRange(r + 1, 3).setValue('Amortized');
      sheet.getRange(r + 1, 5).setValue('Amortized');
      updatedRows++;
    }
  }
  if (updatedRows > 0) {
    Logger.log('Updated ' + updatedRows + ' existing subscription rows to Type: Amortized');
  }

  // If old Water Filter Servicing (₹150 rate) was previously added, remove it so the new ₹183.33 rate applies
  for (var r = existingData.length - 1; r >= 1; r--) {
    var rowTitle = (existingData[r][1] || '').toString();
    var rowAmt = parseFloat(existingData[r][3]) || 0;
    if (rowTitle.indexOf('Water Filter Servicing') !== -1 && Math.abs(rowAmt - 150) < 0.1) {
      sheet.deleteRow(r + 1);
      delete existingTitles[rowTitle];
    }
  }

  // 1. Wifi Worldspace (6 months, ₹2500 total, from 25 Aug 2026) -> ₹416.67/mo
  addAmortizedSplit('Wifi Worldspace', 2500, 6, 25, 8, 2026);

  // 2. Internet Jio (3 months, ₹900 total, from 1 Sept 2026) -> ₹300/mo
  addAmortizedSplit('Internet Jio', 900, 3, 1, 9, 2026);

  // 3. Water Tank Cleaning (12 months, ₹1500 total, from 1 Sept 2026) -> ₹125/mo
  addAmortizedSplit('Water Tank Cleaning', 1500, 12, 1, 9, 2026);

  // 4. Mediclaim (12 months, ₹8000 total, from 22 Aug 2026) -> ₹666.67/mo
  addAmortizedSplit('Mediclaim', 8000, 12, 22, 8, 2026);

  // 5. House Insurance (12 months, ₹4000 total, from 24 May 2026) -> ₹333.33/mo
  addAmortizedSplit('House Insurance', 4000, 12, 24, 5, 2026);

  // 6. Water Filter Servicing (12 months, ₹2200 total, from 1 Apr 2026) -> ₹183.33/mo
  addAmortizedSplit('Water Filter Servicing', 2200, 12, 1, 4, 2026);

  // 7. Chacha Mediclaim (12 months, ₹5000 total, from 21 Aug 2026) -> ₹416.67/mo
  addAmortizedSplit('Chacha Mediclaim', 5000, 12, 21, 8, 2026);

  // 8. Property Tax (12 months, ₹1500 total, from 1 Apr 2026) -> ₹125/mo
  addAmortizedSplit('Property Tax', 1500, 12, 1, 4, 2026);

  // 9. GST Filing (12 months, ₹500/mo, from 1 Apr 2026 to Mar 2027)
  addMonthlyRecurring('GST Filing', 500, 12, 1, 4, 2026);

  // 10. ITR Filing (12 months, ₹2000 total, from 30 Aug 2026) -> ₹166.67/mo
  addAmortizedSplit('ITR Filing', 2000, 12, 30, 8, 2026);

  // 11. Domain curiouslymotivated.com (12 months, ₹977 total, from 8 Feb 2026) -> ₹81.42/mo
  addAmortizedSplit('Domain curiouslymotivated.com', 977, 12, 8, 2, 2026);

  // 12. Domain spwn.in (12 months, ₹572 total, from 10 Aug 2026) -> ₹47.67/mo
  addAmortizedSplit('Domain spwn.in', 572, 12, 10, 8, 2026);

  // 13. YouTube Premium (12 months recurring, ₹89/mo, from 1 Jan 2026 to Dec 2026)
  addMonthlyRecurring('YouTube Premium', 89, 12, 1, 1, 2026);

  if (rowsToAdd.length > 0) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rowsToAdd.length, 7).setValues(rowsToAdd);
    Logger.log('Added ' + rowsToAdd.length + ' split subscription rows.');
  } else {
    Logger.log('No new rows to add (all already exist).');
  }

  // Always keep sheet sorted chronologically by Date
  sortSheetByDate(sheet);
  Logger.log('Sheet sorted chronologically.');
}

/**
 * Adds months to a date safely without day-of-month overflow.
 * E.g., Jan 31 + 1 month = Feb 28, not Mar 3.
 */
function addMonths(baseDate, monthsToAdd) {
  var d = new Date(baseDate.getTime());
  var targetYear = d.getFullYear();
  var targetMonth = d.getMonth() + monthsToAdd;
  var daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  var targetDay = Math.min(d.getDate(), daysInTargetMonth);
  return new Date(targetYear, targetMonth, targetDay);
}

/**
 * Scans sheet for all recurring/amortized subscriptions (3m, 6m, 12m)
 * and calculates their exact expiry/renewal dates and days remaining.
 *
 * @param {Sheet} targetSheet Optional sheet reference
 * @param {number} daysAhead Threshold in days to consider 'expiring soon' (default: 45)
 * @returns {Array<Object>} List of subscriptions sorted by expiry date ascending
 */
function getSubscriptionRenewals(targetSheet, daysAhead) {
  var sheet = targetSheet || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  var thresholdDays = typeof daysAhead === 'number' ? daysAhead : 45;

  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  var subs = {};

  for (var i = 1; i < data.length; i++) {
    var rowDateVal = data[i][0];
    var title = (data[i][1] || '').toString().trim();
    var type = (data[i][2] || '').toString();
    var amount = parseFloat(data[i][3]) || 0;
    var tag = (data[i][4] || '').toString();
    var eff = parseFloat(data[i][5]) || 0;

    if (!title || amount <= 0) continue;

    // Pattern 1: Amortized split like "Wifi Worldspace (6/6)" or "Internet Jio (1/3)"
    var splitMatch = title.match(/^(.+?)\s*\((\d+)\/(\d+)\)$/);
    if (splitMatch) {
      var baseTitle = splitMatch[1].trim();
      var part = parseInt(splitMatch[2], 10);
      var totalParts = parseInt(splitMatch[3], 10);
      var rowDate = parseDateValue(rowDateVal);

      if (!subs[baseTitle]) {
        subs[baseTitle] = {
          title: baseTitle,
          subType: 'split',
          totalDuration: totalParts,
          monthlyCost: eff || amount,
          totalAmount: 0,
          datesByPart: {},
          firstPartSeen: part,
          lastPartSeen: part,
          minDate: rowDate,
          maxDate: rowDate
        };
      }

      var s = subs[baseTitle];
      s.datesByPart[part] = rowDate;
      s.totalAmount += amount;
      if (eff > 0) s.monthlyCost = eff;

      if (part < s.firstPartSeen) s.firstPartSeen = part;
      if (part > s.lastPartSeen) s.lastPartSeen = part;
      if (rowDate.getTime() < s.minDate.getTime()) s.minDate = rowDate;
      if (rowDate.getTime() > s.maxDate.getTime()) s.maxDate = rowDate;
      continue;
    }

    // Pattern 2: Monthly recurring like "GST Filing (Apr 2026)" or "YouTube Premium (Dec 2026)"
    var recurringMatch = title.match(/^(.+?)\s*\(([A-Za-z]{3}\s+\d{4})\)$/);
    if (recurringMatch) {
      var recTitle = recurringMatch[1].trim();
      var recDate = parseDateValue(rowDateVal);

      if (!subs[recTitle]) {
        subs[recTitle] = {
          title: recTitle,
          subType: 'recurring',
          totalDuration: 12,
          monthlyCost: eff || amount,
          totalAmount: 0,
          minDate: recDate,
          maxDate: recDate,
          monthCount: 0
        };
      }

      var rSub = subs[recTitle];
      rSub.totalAmount += amount;
      rSub.monthCount += 1;
      if (eff > 0) rSub.monthlyCost = eff;
      if (recDate.getTime() < rSub.minDate.getTime()) rSub.minDate = recDate;
      if (recDate.getTime() > rSub.maxDate.getTime()) rSub.maxDate = recDate;
      continue;
    }
  }

  var results = [];

  for (var key in subs) {
    var item = subs[key];
    var startDate;
    var renewalDate;

    if (item.subType === 'split') {
      var totalMonths = item.totalDuration || 1;
      if (item.datesByPart[1]) {
        startDate = item.datesByPart[1];
        renewalDate = addMonths(startDate, totalMonths);
      } else {
        // Derive from known part
        var anyPart = item.lastPartSeen;
        var anyDate = item.datesByPart[anyPart];
        startDate = addMonths(anyDate, -(anyPart - 1));
        renewalDate = addMonths(anyDate, totalMonths - anyPart + 1);
      }
    } else {
      // Recurring: renewal is 1 month after the latest logged month
      startDate = item.minDate;
      renewalDate = addMonths(item.maxDate, 1);
    }

    var expiryPure = new Date(renewalDate.getFullYear(), renewalDate.getMonth(), renewalDate.getDate());
    var diffTime = expiryPure.getTime() - today.getTime();
    var diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    var isOverdue = diffDays < 0;
    var isExpiringSoon = diffDays >= 0 && diffDays <= thresholdDays;

    var status = 'active';
    if (isOverdue) {
      status = 'overdue';
    } else if (diffDays === 0) {
      status = 'today';
    } else if (diffDays <= 7) {
      status = 'week';
    } else if (diffDays <= thresholdDays) {
      status = 'soon';
    }

    var durationLabel = item.totalDuration + ' months';
    if (item.totalDuration === 12) durationLabel = '1 Year (12m)';
    else if (item.totalDuration === 6) durationLabel = '6 Months';
    else if (item.totalDuration === 3) durationLabel = '3 Months';

    results.push({
      title: item.title,
      duration: item.totalDuration,
      durationLabel: durationLabel,
      monthlyCost: Math.round(item.monthlyCost * 100) / 100,
      totalAmount: Math.round(item.totalAmount * 100) / 100,
      startDate: formatDate(startDate),
      expiryDate: formatDate(renewalDate),
      expiryTimestamp: expiryPure.getTime(),
      daysRemaining: diffDays,
      isOverdue: isOverdue,
      isExpiringSoon: isExpiringSoon,
      status: status
    });
  }

  // Sort chronologically by expiry date (earliest renewals first)
  results.sort(function(a, b) {
    return a.expiryTimestamp - b.expiryTimestamp;
  });

  return results;
}

/**
 * Diagnostic runner for renewals to inspect in Apps Script execution log:
 * Select 'testRenewals' from dropdown -> click '▷ Run'.
 */
function testRenewals() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var renewals = getSubscriptionRenewals(sheet, 60);
  Logger.log('Found ' + renewals.length + ' active subscriptions:');
  for (var i = 0; i < renewals.length; i++) {
    var r = renewals[i];
    Logger.log('[' + r.status.toUpperCase() + '] ' + r.title + ' (' + r.durationLabel + ') | Renewal: ' + r.expiryDate + ' (' + r.daysRemaining + ' days remaining) | Total: ₹' + r.totalAmount);
  }
  return renewals;
}


