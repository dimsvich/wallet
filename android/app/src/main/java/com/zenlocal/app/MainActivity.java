package com.zenlocal.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Bundle;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;
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
                    // Экранируем переносы строк для передачи в JS
                    String safeText = text.replace("\n", "\\n").replace("'", "\\'");
                    String jsCode = "if(window.processPushNotification) { window.processPushNotification('" + safeText + "', " + time + "); }";
                    
                    // Запускаем твою JS-функцию прямо в Capacitor WebView
                    getBridge().getWebView().post(() -> {
                        getBridge().getWebView().evaluateJavascript(jsCode, null);
                    });
                }
            }
        };
        
        LocalBroadcastManager.getInstance(this).registerReceiver(
                pushReceiver, new IntentFilter("com.zenlocal.app.NEW_BANK_PUSH")
        );
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (pushReceiver != null) {
            LocalBroadcastManager.getInstance(this).unregisterReceiver(pushReceiver);
        }
    }
}