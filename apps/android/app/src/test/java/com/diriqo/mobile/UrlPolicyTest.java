package com.diriqo.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public final class UrlPolicyTest {
    @Test public void acceptsOnlyExactSecureApplicationOrigin() {
        for (String url : new String[]{"https://app.diriqo.com", "https://app.diriqo.com/mobile/my", "https://APP.DIRIQO.COM:443/mobile/manager?tab=team"}) assertTrue(url, UrlPolicy.isInternal(url));
        for (String url : new String[]{"http://app.diriqo.com", "https://app.diriqo.com.evil.test", "https://app.diriqo.com@evil.test", "https://evil.test@app.diriqo.com", "https://app.diriqo.com:444/", "https://app.diriqo.com./", "https://app.diriqo.com\\@evil.test", "//app.diriqo.com", "file:///private/data", "content://com.diriqo.my.capture/a", "javascript:alert(1)", "intent://app.diriqo.com", " https://app.diriqo.com", "https://app.diriqo.com/%0d%0aLocation:evil", null}) assertFalse(String.valueOf(url), UrlPolicy.isInternal(url));
    }
    @Test public void externalIntentsAreRestricted() {
        assertTrue(UrlPolicy.canOpenExternal("https://diriqo.com"));
        assertTrue(UrlPolicy.canOpenExternal("tel:+420123456789"));
        assertTrue(UrlPolicy.canOpenExternal("mailto:office@example.com?subject=Diriqo"));
        assertTrue(UrlPolicy.canOpenExternal("geo:50.08,14.42?q=Praha"));
        for (String url : new String[]{"intent://evil#Intent;scheme=file;end", "tel:*123#", "tel:123;content://private", "mailto:user@example.com%0d%0abcc:other@test", "http://example.com", "https://user:password@example.com", "javascript:location.href='https://example.com'"}) assertFalse(url, UrlPolicy.canOpenExternal(url));
    }
    @Test public void storageDownloadsBelongOnlyToDiriqoSignedObjects() {
        assertTrue(UrlPolicy.isStorageDownload("https://wfcpfraxiuhuglnuaxqj.supabase.co/storage/v1/object/sign/documents/example?token=synthetic"));
        assertFalse(UrlPolicy.isStorageDownload("https://another.supabase.co/storage/v1/object/sign/documents/a"));
        assertFalse(UrlPolicy.isStorageDownload("https://wfcpfraxiuhuglnuaxqj.supabase.co/rest/v1/profiles"));
        assertFalse(UrlPolicy.isStorageDownload("https://wfcpfraxiuhuglnuaxqj.supabase.co.evil.test/storage/v1/object/sign/a"));
    }
    @Test public void authRecognitionRequiresTrustedOrigin() {
        assertTrue(UrlPolicy.isAuthenticationPath("https://app.diriqo.com/sign-in"));
        assertTrue(UrlPolicy.isAuthenticationPath("https://app.diriqo.com/auth/continue"));
        assertFalse(UrlPolicy.isAuthenticationPath("https://evil.test/sign-in"));
        assertFalse(UrlPolicy.isAuthenticationPath("https://app.diriqo.com/mobile/my"));
    }
}
