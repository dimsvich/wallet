package com.zenlocal.app;

import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.Log;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.Plugin;

import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;

public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {
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
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN && requestCode < GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) {
            PluginHandle pluginHandle = getBridge().getPlugin("SocialLogin");
            if (pluginHandle == null) return;
            Plugin plugin = pluginHandle.getInstance();
            if (!(plugin instanceof SocialLoginPlugin)) return;
            ((SocialLoginPlugin) plugin).handleGoogleLoginIntent(requestCode, data);
        }
    }
    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}

    @Override
    public void onResume() {
        super.onResume();
        checkNotificationPermission();
        processMissedPushes();
    }

    // Читаем фоновую очередь пушей при открытии приложения
    private void processMissedPushes() {
        SharedPreferences prefs = getSharedPreferences("ZenPushQueue", Context.MODE_PRIVATE);
        String queueStr = prefs.getString("queue", "[]");
        
        if (!queueStr.equals("[]")) {
            // Очищаем блокнот
            prefs.edit().putString("queue", "[]").apply();
            
            // Передаем данные в JS с задержкой 3 сек, чтобы WebView успел загрузиться
            String safeQueue = queueStr.replace("'", "\\'").replace("\\", "\\\\");
            String jsCode = "if(window.processMissedPushes) { window.processMissedPushes('" + safeQueue + "'); }";
            
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().postDelayed(() -> {
                    getBridge().getWebView().evaluateJavascript(jsCode, null);
                }, 3000); 
            }
        }
    }

    private void checkNotificationPermission() {
        if (!isNotificationServiceEnabled()) {
            new AlertDialog.Builder(this)
                .setTitle("Автоматизация Приват24")
                .setMessage("Включите доступ к уведомлениям для авто-синхронизации.")
                .setPositiveButton("Включить", (dialog, id) -> {
                    startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
                })
                .setNegativeButton("Позже", null).show();
        }
    }

    private boolean isNotificationServiceEnabled() {
        String pkgName = getPackageName();
        final String flat = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        if (!TextUtils.isEmpty(flat)) {
            final String[] names = flat.split(":");
            for (String name : names) {
                final ComponentName cn = ComponentName.unflattenFromString(name);
                if (cn != null && TextUtils.equals(pkgName, cn.getPackageName())) return true;
            }
        }
        return false;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (pushReceiver != null) unregisterReceiver(pushReceiver);
    }
}