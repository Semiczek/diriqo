package com.diriqo.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public final class DownloadPolicyTest {
    @Test public void namesCannotEscapeDestinationOrContainControls() {
        assertEquals("_private_passwords.csv", DownloadPolicy.safeName("../private/passwords.csv"));
        assertEquals("a_b_.pdf", DownloadPolicy.safeName("a\nb\r.pdf"));
        assertEquals("diriqo-dokument", DownloadPolicy.safeName("..."));
        assertEquals("nabídka.pdf", DownloadPolicy.safeName("nabídka.pdf"));
        assertTrue(DownloadPolicy.safeName("x".repeat(300)).length() <= 100);
    }
    @Test public void mimeDoesNotPermitHeaderInjection() {
        assertEquals("application/pdf", DownloadPolicy.safeMime("application/pdf; charset=utf-8"));
        assertEquals("application/octet-stream", DownloadPolicy.safeMime("image/png\r\nX-Evil: yes"));
        assertEquals("application/octet-stream", DownloadPolicy.safeMime(null));
    }
    @Test public void redirectNeverForwardsSessionToThirdParty() {
        assertTrue(DownloadPolicy.canRedirect("https://app.diriqo.com/export", "https://app.diriqo.com/export/1"));
        assertTrue(DownloadPolicy.canRedirect("https://app.diriqo.com/file", "https://wfcpfraxiuhuglnuaxqj.supabase.co/storage/v1/object/sign/a?token=test"));
        assertFalse(DownloadPolicy.canRedirect("https://app.diriqo.com/export", "https://evil.test"));
        assertFalse(DownloadPolicy.canRedirect("https://wfcpfraxiuhuglnuaxqj.supabase.co/storage/v1/object/sign/a", "https://app.diriqo.com/export"));
    }
}
