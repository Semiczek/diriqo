package com.diriqo.mobile;

import java.util.Locale;

public final class DownloadPolicy {
    public static final long MAX_BYTES = 25L * 1024 * 1024;
    private DownloadPolicy() {}
    public static String safeName(String name) {
        if (name == null || name.isBlank()) return "diriqo-dokument";
        String clean = name.replaceAll("[\\p{Cntrl}\\\\/:*?\"<>|]", "_").replaceAll("^\\.+", "").trim();
        if (clean.length() > 100) clean = clean.substring(clean.length() - 100);
        return clean.isBlank() ? "diriqo-dokument" : clean;
    }
    public static String safeMime(String mime) {
        if (mime == null) return "application/octet-stream";
        String value = mime.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        return value.matches("[a-z0-9.+-]+/[a-z0-9.+-]+") ? value : "application/octet-stream";
    }
    public static boolean canRedirect(String current, String next) {
        return UrlPolicy.isInternal(current) && (UrlPolicy.isInternal(next) || UrlPolicy.isStorageDownload(next));
    }
}
