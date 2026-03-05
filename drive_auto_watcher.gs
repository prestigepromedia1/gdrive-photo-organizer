/**
 * ============================================================================
 * Drive Auto-Watcher
 * ============================================================================
 * Automatically processes new files in Google Drive folders:
 *
 *   1. Video folders     -> Rename to TTS--[CreatorName].mp4
 *   2. Product drop folder -> OCR product label -> Sort into product folder
 *
 * SETUP:
 *   1. Go to https://script.google.com  ->  New Project
 *   2. Paste this entire file into Code.gs
 *   3. Enable the Cloud Vision API:
 *      - Resources > Advanced Google Services > enable "Cloud Vision API"
 *      - Also enable it in Google Cloud Console (APIs & Services > Library)
 *   4. Add your API key: Project Settings > Script Properties > VISION_API_KEY
 *   5. Fill in the CONFIGURATION section below with your folder IDs and products
 *   6. Run  setup()  once (from the editor toolbar) to create the time trigger
 *   7. Authorize when prompted
 *
 * The watcher runs every 5 minutes automatically.
 * ============================================================================
 */

// ============================================================================
// CONFIGURATION — Edit these values for your setup
// ============================================================================

/**
 * Video folders to watch for auto-rename.
 * Get the folder ID from the Drive URL: drive.google.com/drive/folders/YOUR_ID_HERE
 */
const VIDEO_FOLDERS = [
  // 'YOUR_FOLDER_ID_1',   // Folder name / description
  // 'YOUR_FOLDER_ID_2',   // Another folder
];

/**
 * Product photo parent folder (contains sub-folders per product).
 * A "_New Photos" drop folder will be created inside this automatically.
 */
const PRODUCT_PARENT_FOLDER = 'YOUR_PARENT_FOLDER_ID';

/** How often to check (minutes). Minimum 1. */
const CHECK_INTERVAL_MINUTES = 5;

/**
 * Video rename prefix. Files matching TikTok/social patterns get renamed to:
 *   PREFIX--[CreatorName].mp4
 */
const VIDEO_RENAME_PREFIX = 'TTS';

// ============================================================================
// PRODUCT CATALOG — Add your products here
// ============================================================================

/**
 * Each product needs:
 *   title:      Display name (used in renamed filenames)
 *   folder_id:  Google Drive folder ID for this product
 *   label_text: Text that appears on the product label (for OCR matching)
 *   keywords:   Filename keywords (for quick matching without OCR)
 *
 * Example:
 *   {
 *     title: 'Blue Mountain Blend',
 *     folder_id: 'YOUR_PRODUCT_FOLDER_ID',
 *     label_text: ['BLUE MOUNTAIN BLEND', 'BLUE MOUNTAIN'],
 *     keywords: ['blue mountain', 'mountain blend'],
 *   },
 */
const PRODUCTS = [
  // Add your products here. Example:
  // {
  //   title: 'Product Name',
  //   folder_id: 'DRIVE_FOLDER_ID',
  //   label_text: ['LABEL TEXT ON PACKAGING'],
  //   keywords: ['keyword1', 'keyword2'],
  // },
];


// ============================================================================
// SETUP — Run this once
// ============================================================================

function setup() {
  // Create the drop folder if it doesn't exist
  var parent = DriveApp.getFolderById(PRODUCT_PARENT_FOLDER);
  var dropFolders = parent.getFoldersByName('_New Photos');
  var dropFolder;

  if (dropFolders.hasNext()) {
    dropFolder = dropFolders.next();
    Logger.log('Drop folder already exists: ' + dropFolder.getUrl());
  } else {
    dropFolder = parent.createFolder('_New Photos');
    Logger.log('Created drop folder: ' + dropFolder.getUrl());
  }

  // Also create _Review folder
  var reviewFolders = parent.getFoldersByName('_Review');
  if (!reviewFolders.hasNext()) {
    parent.createFolder('_Review');
    Logger.log('Created _Review folder');
  }

  // Save the drop folder ID in script properties
  PropertiesService.getScriptProperties().setProperty('DROP_FOLDER_ID', dropFolder.getId());

  // Delete existing triggers to avoid duplicates
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }

  // Create time-based trigger
  ScriptApp.newTrigger('processAll')
    .timeBased()
    .everyMinutes(CHECK_INTERVAL_MINUTES)
    .create();

  Logger.log('Trigger created: runs every ' + CHECK_INTERVAL_MINUTES + ' minutes');
  Logger.log('');
  Logger.log('SETUP COMPLETE');
  Logger.log('Drop folder for new photos: ' + dropFolder.getUrl());
  Logger.log('Share this folder link with your client.');
}


// ============================================================================
// MAIN ENTRY POINT — Called by trigger every 5 minutes
// ============================================================================

function processAll() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log('Another instance is running, skipping.');
    return;
  }

  try {
    // 1. Process video folders
    for (var i = 0; i < VIDEO_FOLDERS.length; i++) {
      processVideoFolder_(VIDEO_FOLDERS[i]);
    }

    // 2. Process product drop folder
    var dropId = PropertiesService.getScriptProperties().getProperty('DROP_FOLDER_ID');
    if (dropId) {
      processProductDropFolder_(dropId);
    }
  } finally {
    lock.releaseLock();
  }
}


// ============================================================================
// VIDEO AUTO-RENAME
// ============================================================================

/**
 * Find files in a video folder that haven't been renamed yet,
 * and rename them to PREFIX--[CreatorName].ext
 */
function processVideoFolder_(folderId) {
  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFiles();
  var renamed = 0;
  var prefix = VIDEO_RENAME_PREFIX + '--';

  // First pass: count existing prefixed names to handle sequence numbers
  var creatorCounts = {};
  var allFiles = [];
  while (files.hasNext()) {
    allFiles.push(files.next());
  }

  // Count existing renamed files per creator
  var prefixPattern = new RegExp('^' + VIDEO_RENAME_PREFIX + '--([^_\\.]+)');
  for (var i = 0; i < allFiles.length; i++) {
    var name = allFiles[i].getName();
    var ttsMatch = name.match(prefixPattern);
    if (ttsMatch) {
      var c = ttsMatch[1];
      creatorCounts[c] = (creatorCounts[c] || 0) + 1;
    }
  }

  // Process un-renamed files
  for (var i = 0; i < allFiles.length; i++) {
    var file = allFiles[i];
    var name = file.getName();

    // Skip already renamed files
    if (name.indexOf(prefix) === 0) continue;

    var creator = null;

    // Pattern 1: tiktok_CREATOR_DATE...
    var m1 = name.match(/^tiktok_(.+?)_\d{8}/);
    if (m1) creator = m1[1];

    // Pattern 2: CREATOR_tiktok_DATE...
    if (!creator) {
      var m2 = name.match(/^(.+?)_tiktok_\d{8}/);
      if (m2) creator = m2[1];
    }

    // Pattern 3: CREATOR_PLATFORM_DATE (generic social video archiver output)
    if (!creator) {
      var m3 = name.match(/^(.+?)_(instagram|youtube|twitter|x|facebook|reddit)_\d{8}/i);
      if (m3) creator = m3[1];
    }

    // Pattern 4: snaptik_ files
    if (!creator && name.indexOf('snaptik_') === 0) {
      creator = 'unknown';
    }

    if (!creator) continue;

    // Build new name with sequence
    creatorCounts[creator] = (creatorCounts[creator] || 0) + 1;
    var count = creatorCounts[creator];
    var ext = '.mp4';
    var dotIdx = name.lastIndexOf('.');
    if (dotIdx > 0) ext = name.substring(dotIdx);

    var newName = count === 1
      ? prefix + creator + ext
      : prefix + creator + '_' + count + ext;

    file.setName(newName);
    logRename_(folderId, name, newName, 'auto-rename', creator, folder.getName());
    Logger.log('Video rename: ' + name + ' -> ' + newName);
    renamed++;
  }

  if (renamed > 0) {
    Logger.log('Video folder ' + folder.getName() + ': renamed ' + renamed + ' files');
  }
}


// ============================================================================
// PRODUCT DROP FOLDER — OCR + AUTO-SORT
// ============================================================================

/**
 * Process new images in the product drop folder.
 * Uses filename matching first, then Cloud Vision OCR.
 */
function processProductDropFolder_(dropFolderId) {
  var folder = DriveApp.getFolderById(dropFolderId);
  var files = folder.getFiles();
  var processed = 0;

  while (files.hasNext()) {
    var file = files.next();
    var name = file.getName();
    var mime = file.getMimeType();

    // Only process images
    if (mime.indexOf('image/') !== 0) continue;

    Logger.log('Processing: ' + name);

    // Step 1: Try filename matching
    var match = matchByFilename_(name);

    // Step 2: Try OCR if no filename match
    if (!match) {
      match = matchByOCR_(file);
    }

    if (match) {
      // Move to product folder
      var destFolder = DriveApp.getFolderById(match.folder_id);
      file.moveTo(destFolder);

      // Rename with product prefix + sequence
      var seq = countImagesInFolder_(destFolder);
      var ext = getExtension_(name);
      var newName = slugify_(match.title) + '_' + padNum_(seq) + ext;
      file.setName(newName);

      logRename_(PRODUCT_PARENT_FOLDER, name, newName, match.method, match.title, match.title);
      Logger.log('  -> ' + match.title + ' (' + match.method + ') -> ' + newName);
      processed++;
    } else {
      // Move to _Review
      var parent = DriveApp.getFolderById(PRODUCT_PARENT_FOLDER);
      var reviewFolders = parent.getFoldersByName('_Review');
      if (reviewFolders.hasNext()) {
        file.moveTo(reviewFolders.next());
        logRename_(PRODUCT_PARENT_FOLDER, name, name, 'unmatched', 'Unknown', '_Review');
        Logger.log('  -> _Review (no match)');
      }
      processed++;
    }
  }

  if (processed > 0) {
    Logger.log('Product drop folder: processed ' + processed + ' files');
    sendNotification_(processed);
  }
}


/**
 * Try to match an image by its filename against product keywords.
 */
function matchByFilename_(filename) {
  var lower = filename.toLowerCase();

  for (var i = 0; i < PRODUCTS.length; i++) {
    var product = PRODUCTS[i];

    // Check keywords
    for (var k = 0; k < product.keywords.length; k++) {
      if (lower.indexOf(product.keywords[k].toLowerCase()) >= 0) {
        return {
          title: product.title,
          folder_id: product.folder_id,
          method: 'filename',
          confidence: 0.85
        };
      }
    }
  }

  return null;
}


/**
 * Use Google Cloud Vision OCR to read text from the image,
 * then match against product label_text entries.
 */
function matchByOCR_(file) {
  try {
    var blob = file.getBlob();
    var bytes = blob.getBytes();
    var base64 = Utilities.base64Encode(bytes);

    // Call Cloud Vision API
    var request = {
      requests: [{
        image: { content: base64 },
        features: [{ type: 'TEXT_DETECTION', maxResults: 10 }]
      }]
    };

    var response = UrlFetchApp.fetch(
      'https://vision.googleapis.com/v1/images:annotate?key=' + getVisionApiKey_(),
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(request),
        muteHttpExceptions: true
      }
    );

    var result = JSON.parse(response.getContentText());
    var annotations = result.responses[0].textAnnotations;

    if (!annotations || annotations.length === 0) return null;

    var detectedText = annotations[0].description.toUpperCase();
    Logger.log('  OCR text: ' + detectedText.substring(0, 80));

    // Match against label_text entries (longest match wins)
    var bestMatch = null;
    var bestLength = 0;

    for (var i = 0; i < PRODUCTS.length; i++) {
      var product = PRODUCTS[i];

      for (var j = 0; j < product.label_text.length; j++) {
        var label = product.label_text[j].toUpperCase();
        if (detectedText.indexOf(label) >= 0 && label.length > bestLength) {
          bestMatch = {
            title: product.title,
            folder_id: product.folder_id,
            method: 'ocr',
            confidence: 0.90
          };
          bestLength = label.length;
        }
      }
    }

    return bestMatch;
  } catch (e) {
    Logger.log('  OCR error: ' + e.message);
    return null;
  }
}


// ============================================================================
// RENAME LOG — Google Sheet in each folder root
// ============================================================================

/** Sheet name used for rename logs */
var LOG_SHEET_NAME = '_Rename Log';

/**
 * Get or create a Google Sheet rename log in the given folder.
 * Returns the Sheet object (first tab).
 */
function getOrCreateLog_(folderId) {
  var folder = DriveApp.getFolderById(folderId);
  var existing = folder.getFilesByName(LOG_SHEET_NAME);

  if (existing.hasNext()) {
    var file = existing.next();
    return SpreadsheetApp.open(file).getActiveSheet();
  }

  // Create new spreadsheet
  var ss = SpreadsheetApp.create(LOG_SHEET_NAME);
  var sheet = ss.getActiveSheet();
  sheet.appendRow(['Timestamp', 'Original Filename', 'New Filename', 'Method', 'Product/Creator', 'Destination Folder']);
  sheet.getRange('1:1').setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 160);
  sheet.setColumnWidth(2, 300);
  sheet.setColumnWidth(3, 300);
  sheet.setColumnWidth(4, 100);
  sheet.setColumnWidth(5, 200);
  sheet.setColumnWidth(6, 200);

  // Move the spreadsheet into the target folder
  var file = DriveApp.getFileById(ss.getId());
  file.moveTo(folder);

  Logger.log('Created rename log in: ' + folder.getName());
  return sheet;
}

/**
 * Append a row to the rename log for a given folder.
 */
function logRename_(folderId, originalName, newName, method, product, destFolder) {
  var sheet = getOrCreateLog_(folderId);
  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([timestamp, originalName, newName, method, product, destFolder]);
}


// ============================================================================
// HELPERS
// ============================================================================

function getVisionApiKey_() {
  // Store your API key in Script Properties (Project Settings > Script Properties)
  // Key name: VISION_API_KEY
  var key = PropertiesService.getScriptProperties().getProperty('VISION_API_KEY');
  if (!key) {
    throw new Error(
      'VISION_API_KEY not set. Go to Project Settings > Script Properties and add it.'
    );
  }
  return key;
}

function countImagesInFolder_(folder) {
  var files = folder.getFiles();
  var count = 0;
  while (files.hasNext()) {
    var f = files.next();
    if (f.getMimeType().indexOf('image/') === 0) count++;
  }
  return count;
}

function slugify_(text) {
  return text
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .trim();
}

function padNum_(n) {
  if (n < 10) return '00' + n;
  if (n < 100) return '0' + n;
  return '' + n;
}

function getExtension_(filename) {
  var dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.substring(dot).toLowerCase() : '.jpg';
}

/**
 * Optional: Send an email notification when files are processed.
 * Uncomment and set your email address below.
 */
function sendNotification_(count) {
  // MailApp.sendEmail(
  //   'you@example.com',
  //   'Auto-Sort: ' + count + ' photos processed',
  //   count + ' new photos were automatically sorted into product folders.\n\n' +
  //   'Check the _Review folder for any that could not be identified.'
  // );
}


// ============================================================================
// MANUAL TRIGGERS — Run these from the Apps Script editor
// ============================================================================

/** Run once to process everything now (instead of waiting for timer) */
function runNow() {
  processAll();
}

/** Check the drop folder contents without processing */
function checkDropFolder() {
  var dropId = PropertiesService.getScriptProperties().getProperty('DROP_FOLDER_ID');
  if (!dropId) {
    Logger.log('No drop folder configured. Run setup() first.');
    return;
  }
  var folder = DriveApp.getFolderById(dropId);
  var files = folder.getFiles();
  var count = 0;
  while (files.hasNext()) {
    Logger.log('  ' + files.next().getName());
    count++;
  }
  Logger.log('Total files in drop folder: ' + count);
}

/** Remove all triggers (pause the watcher) */
function pauseWatcher() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
  Logger.log('All triggers removed. Watcher paused.');
}

/** Resume the watcher after pausing */
function resumeWatcher() {
  pauseWatcher(); // Clear any existing
  ScriptApp.newTrigger('processAll')
    .timeBased()
    .everyMinutes(CHECK_INTERVAL_MINUTES)
    .create();
  Logger.log('Watcher resumed.');
}
