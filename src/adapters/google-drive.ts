import { containsLikelySecret, containsSensitivePath } from "../security.js";
import { inferDateFromName } from "../text.js";
import type { RawDocument } from "../types.js";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  createdTime: string;
  webViewLink?: string;
}

const refreshAccessToken = async (
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<string> => {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  if (!response.ok) throw new Error(`Google OAuth ${response.status}`);
  const payload = (await response.json()) as { access_token: string };
  return payload.access_token;
};

const driveRequest = async <T>(
  accessToken: string,
  url: string
): Promise<T> => {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    throw new Error(`Google Drive ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
};

const readText = async (
  accessToken: string,
  file: DriveFile
): Promise<string | null> => {
  let url: string | null = null;
  if (file.mimeType === "application/vnd.google-apps.document") {
    url = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text%2Fplain`;
  } else if (
    file.mimeType.startsWith("text/") ||
    /\.(md|txt|json)$/i.test(file.name)
  ) {
    url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
  }
  if (!url) return null;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) return null;
  return response.text();
};

export const readGoogleDriveDocuments = async (
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  rootFolderIds: string[]
): Promise<RawDocument[]> => {
  const accessToken = await refreshAccessToken(clientId, clientSecret, refreshToken);
  const documents: RawDocument[] = [];
  const visited = new Set<string>();

  const visitFolder = async (folderId: string): Promise<void> => {
    if (visited.has(folderId)) return;
    visited.add(folderId);
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false`,
        pageSize: "100",
        fields:
          "nextPageToken,files(id,name,mimeType,modifiedTime,createdTime,webViewLink)"
      });
      if (pageToken) params.set("pageToken", pageToken);
      const response = await driveRequest<{
        files: DriveFile[];
        nextPageToken?: string;
      }>(accessToken, `https://www.googleapis.com/drive/v3/files?${params}`);
      for (const file of response.files) {
        if (containsSensitivePath(file.name)) continue;
        if (file.mimeType === "application/vnd.google-apps.folder") {
          await visitFolder(file.id);
          continue;
        }
        const content = await readText(accessToken, file);
        if (!content || containsLikelySecret(content)) continue;
        documents.push({
          source_type: "google_drive",
          source_uri:
            file.webViewLink ?? `https://drive.google.com/open?id=${file.id}`,
          title: file.name,
          recorded_at: inferDateFromName(file.name) ?? file.createdTime,
          modified_at: file.modifiedTime,
          content,
          author_role: "user",
          metadata: { google_drive_file_id: file.id, mime_type: file.mimeType }
        });
      }
      pageToken = response.nextPageToken;
    } while (pageToken);
  };

  for (const folderId of rootFolderIds) await visitFolder(folderId);
  return documents;
};
