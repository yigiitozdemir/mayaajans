package net.mayaajans.ekip;

import com.google.androidbrowserhelper.trusted.NotificationPermissionRequestHandler;

/** Web programının bildirimleri bu uygulama adına gösterilir; Android 13+ bildirim izni de buradan istenir. */
public class DelegationService extends com.google.androidbrowserhelper.trusted.DelegationService {
    @Override
    public void onCreate() {
        super.onCreate();
        registerExtraCommandHandler(new NotificationPermissionRequestHandler());
    }
}
