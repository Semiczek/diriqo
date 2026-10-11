package com.diriqo.mobile;

import java.net.URI;
import java.util.Locale;

/** Routing only. Company membership, role and licences remain server-authorized. */
public final class UrlPolicy {
    public static final String ORIGIN = "https://app.diriqo.com";
    private UrlPolicy() {}

    public static URI parse(String value) {
        if (value == null || value.length() > 8192 || !value.equals(value.trim()) || value.contains("\\")) return null;
        String lower = value.toLowerCase(Locale.ROOT);
        if (lower.matches(".*(%0[0-9a-f]|%1[0-9a-f]|%7f).*")) return null;
        for (int i = 0; i < value.length(); i++) if (Character.isISOControl(value.charAt(i))) return null;
        try { return new URI(value); } catch (Exception ignored) { return null; }
    }

    public static boolean isHttps(URI uri) {
        return uri != null && "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null
                && uri.getRawUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    public static boolean isInternal(String value) {
        URI uri = parse(value);
        return isHttps(uri) && "app.diriqo.com".equalsIgnoreCase(uri.getHost());
    }

    public static boolean canOpenExternal(String value) {
        URI uri = parse(value);
        if (uri == null) return false;
        if (isHttps(uri)) return !isInternal(value);
        String scheme = uri.getScheme();
        if (scheme == null) return false;
        if (scheme.equalsIgnoreCase("tel")) return value.substring(value.indexOf(':') + 1).matches("[+0-9(). -]{1,40}");
        if (scheme.equalsIgnoreCase("mailto")) return uri.getRawSchemeSpecificPart().contains("@") && uri.getRawFragment() == null;
        if (scheme.equalsIgnoreCase("geo")) return uri.getRawSchemeSpecificPart().matches("[-+0-9.,?=&%a-zA-Z _~]{1,1024}");
        return false;
    }

    public static boolean isStorageDownload(String value) {
        URI uri = parse(value);
        return isHttps(uri) && "wfcpfraxiuhuglnuaxqj.supabase.co".equalsIgnoreCase(uri.getHost())
                && uri.getPath() != null && uri.getPath().startsWith("/storage/v1/object/sign/");
    }

    public static boolean isAuthenticationPath(String value) {
        if (!isInternal(value)) return false;
        String path = parse(value).getPath();
        return path.equals("/sign-in") || path.equals("/login") || path.startsWith("/auth/")
                || path.equals("/forgot-password") || path.equals("/reset-password");
    }
}
