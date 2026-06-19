const { google } = require('googleapis');
const logger = require('../utils/logger');

const getAuthClient = (accessToken, refreshToken) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
  );

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken
  });

  return oauth2Client;
};

const extractSheetId = (url) => {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
};

const updateSheetWithStatus = async (sheetId, accessToken, refreshToken, emailColumn, statusData) => {
  try {
    const auth = getAuthClient(accessToken, refreshToken);
    const sheets = google.sheets({ version: 'v4', auth });

    // Get sheet metadata
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: sheetId
    });

    const sheetName = spreadsheet.data.sheets[0].properties.title;

    // Get current data to find email column and add status columns
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${sheetName}!A1:ZZ1`
    });

    const headers = response.data.values[0];
    const emailColIndex = headers.indexOf(emailColumn);

    if (emailColIndex === -1) {
      throw new Error('Email column not found');
    }

    // Check if status columns exist, if not add them
    const statusColumns = ['Email Status', 'Sent At', 'Opened At', 'Open Count'];
    const statusColIndices = {};
    
    for (const col of statusColumns) {
      let index = headers.indexOf(col);
      if (index === -1) {
        // Add new column
        headers.push(col);
        index = headers.length - 1;
      }
      statusColIndices[col] = index;
    }

    // Update headers if new columns were added
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${sheetName}!A1:${String.fromCharCode(65 + headers.length - 1)}1`,
      valueInputOption: 'RAW',
      resource: {
        values: [headers]
      }
    });

    // Get all data to find matching rows
    const dataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${sheetName}!A2:${String.fromCharCode(65 + headers.length - 1)}`
    });

    const rows = dataResponse.data.values || [];
    
    // Update each row with status
    const updates = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const email = row[emailColIndex];
      
      if (statusData[email]) {
        const status = statusData[email];
        const rowNum = i + 2; // +2 because row 1 is headers and array is 0-indexed
        
        // Prepare row data
        while (row.length < headers.length) {
          row.push('');
        }
        
        // Convert dates to IST
        const sentAtIST = status.sentAt ? new Date(status.sentAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '';
        const openedAtIST = status.openedAt ? new Date(status.openedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '';
        
        row[statusColIndices['Email Status']] = status.status;
        row[statusColIndices['Sent At']] = sentAtIST;
        row[statusColIndices['Opened At']] = openedAtIST;
        row[statusColIndices['Open Count']] = status.openCount || '0';
        
        updates.push({
          range: `${sheetName}!A${rowNum}:${String.fromCharCode(65 + headers.length - 1)}${rowNum}`,
          values: [row]
        });
      }
    }

    // Batch update all rows
    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        resource: {
          valueInputOption: 'RAW',
          data: updates
        }
      });
    }

    return { success: true, updatedRows: updates.length };
  } catch (error) {
    logger.error({ err: error, sheetId }, 'Update sheet error');
    throw new Error('Failed to update sheet: ' + error.message);
  }
};

const getSheetData = async (sheetId, accessToken, refreshToken) => {
  try {
    if (!accessToken) {
      throw new Error('Not authenticated with Google. Please log out and log in again to grant Google Sheets access.');
    }

    const auth = getAuthClient(accessToken, refreshToken);
    const sheets = google.sheets({ version: 'v4', auth });

    // Get sheet metadata
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: sheetId
    });

    const sheetName = spreadsheet.data.sheets[0].properties.title;

    // Get data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${sheetName}!A1:ZZ`
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      throw new Error('Sheet is empty. Please add headers and data rows to your Google Sheet.');
    }

    if (rows.length === 1) {
      throw new Error('Sheet only has headers. Please add at least one data row.');
    }

    const headers = rows[0];
    const columns = headers.map((name, index) => ({ name, index }));

    const dataRows = rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] || '';
      });
      return obj;
    });

    return {
      name: spreadsheet.data.properties.title,
      columns,
      rows: dataRows,
      totalRows: dataRows.length
    };
  } catch (error) {
    logger.error({ err: error, sheetId }, 'Google Sheets API error');
    
    if (error.message && error.message.includes('refresh token')) {
      throw new Error('Google authentication expired. Please log out and log in again to reconnect Google Sheets.');
    }
    
    if (error.code === 403) {
      throw new Error('Permission denied. Please make sure the sheet is shared with "Anyone with the link can view" or grant access to your Google account.');
    }
    
    if (error.code === 404) {
      throw new Error('Sheet not found. Please check the URL and make sure the sheet exists.');
    }
    
    if (error.code === 401) {
      throw new Error('Authentication failed. Please log out and log in again to grant Google Sheets access.');
    }
    
    throw new Error('Failed to fetch sheet data: ' + error.message);
  }
};

module.exports = {
  getSheetData,
  extractSheetId,
  getAuthClient,
  updateSheetWithStatus
};
