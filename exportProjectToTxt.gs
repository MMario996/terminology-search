/**
 * Exportiert alle Dateien des aktuellen Projekts als .txt Dateien in einen Drive-Ordner.
 * (Inklusive Fehler-Analyse / Debugging)
 */
function exportProjectToTxt() {
  // 1. Einstellungen
  const folderId = "1am6gR_8i_mEg3zv176lfflhGPEYrBPf2"; // Deine Ordner-ID
  const scriptId = ScriptApp.getScriptId(); 
  
  // 2. Zielordner direkt ?ber die ID ansteuern
  const folder = DriveApp.getFolderById(folderId);

  // 3. Apps Script API aufrufen
  const url = "https://script.googleapis.com/v1/projects/" + scriptId + "/content";
  const options = {
    headers: {
      "Authorization": "Bearer " + ScriptApp.getOAuthToken()
    },
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  
  // --- NEUER DEBUG-CODE START ---
  // Das schreibt uns die genaue Antwort von Google in das Protokoll
  Logger.log("API Response Code: " + response.getResponseCode());
  Logger.log("API Response Body: " + response.getContentText());
  // --- NEUER DEBUG-CODE ENDE ---

  const projectContent = JSON.parse(response.getContentText());

  if (!projectContent.files) {
    Logger.log("Fehler: Konnte keine Dateien finden. Schau in die 'API Response Body' Zeile oben im Log!");
    return;
  }

  // 4. Dateien im Ordner ablegen/aktualisieren
  projectContent.files.forEach(file => {
    const fileName = file.name + (file.type === 'HTML' ? '.html' : '.gs') + ".txt";
    const content = file.source || ""; // Falls eine Datei leer ist
    
    const existingFiles = folder.getFilesByName(fileName);
    if (existingFiles.hasNext()) {
      existingFiles.next().setContent(content);
    } else {
      folder.createFile(fileName, content);
    }
  });

  Logger.log("Export abgeschlossen in Ordner: " + folder.getName());
}