package net.mayaajans.ekip;

import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

/**
 * Uygulama açılınca ekip.mayaajans.net tam ekran açılır.
 * Android 13+: ilk açılışta bildirim izni sorulur (cevaptan sonra program açılır).
 */
public class LauncherActivity extends com.google.androidbrowserhelper.trusted.LauncherActivity {
    private static final String POST = "android.permission.POST_NOTIFICATIONS";
    private boolean askFirst;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SharedPreferences prefs = getSharedPreferences("maya", MODE_PRIVATE);
        askFirst = savedInstanceState == null
                && Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(POST) != PackageManager.PERMISSION_GRANTED
                && !prefs.getBoolean("bildirimIzniSoruldu", false);
        super.onCreate(savedInstanceState);
        if (askFirst) {
            prefs.edit().putBoolean("bildirimIzniSoruldu", true).apply();
            requestPermissions(new String[] { POST }, 7);
        }
    }

    @Override
    protected boolean shouldLaunchImmediately() {
        return !askFirst;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 7) launchTwa();
    }
}
