package com.zenlocal.app;

import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Bundle;
import android.provider.Settings;
import android.text.TextUtils;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private BroadcastReceiver pushReceiver;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        pushReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String text = intent.getStringExtra("text");
                long time = intent.getLongExtra("time", 0);
                
                if (text != null) {
                    String safeText = text.replace("\n", "\\n").replace("'", "\\'");
                    String jsCode = "if(window.processPushNotification) { window.processPushNotification('" + safeText + "', " + time + "); }";
                    
                    getBridge().getWebView().post(() -> {
                        getBridge().getWebView().evaluateJavascript(jsCode, null);
                    });
                }
            }
        };
        
        IntentFilter filter = new IntentFilter("com.zenlocal.app.NEW_BANK_PUSH");
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            registerReceiver(pushReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(pushReceiver, filter);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        checkNotificationPermission();
    }

    private void checkNotificationPermission() {
        if (!isNotificationServiceEnabled()) {
            new AlertDialog.Builder(this)
                .setTitle("Автоматизация Приват24")
                .setMessage("Чтобы приложение автоматически записывало расходы из ПриватБанка, ему нужен доступ к уведомлениям. Включите его на следующем экране.")
                .setPositiveButton("Включить", (dialog, id) -> {
                    startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
                })
                .setNegativeButton("Позже", null)
                .show();
        }
    }

    private boolean isNotificationServiceEnabled() {
        String pkgName = getPackageName();
        final String flat = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        if (!TextUtils.isEmpty(flat)) {
            final String[] names = flat.split(":");
            for (int i = 0; i < names.length; i++) {
                final ComponentName cn = ComponentName.unflattenFromString(names[i]);
                if (cn != null && TextUtils.equals(pkgName, cn.getPackageName())) {
                    return true;
                }
            }
        }
        return false;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (pushReceiver != null) {
            unregisterReceiver(pushReceiver);
        }
    }
}