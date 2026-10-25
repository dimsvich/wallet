package com.zenlocal.app;

import android.content.Intent;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;

public class BankNotificationListener extends NotificationListenerService {
    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        String packageName = sbn.getPackageName();
        
        // Перехватываем ТОЛЬКО пуши от Приват24
        if ("ua.privatbank.ap24".equals(packageName)) {
            CharSequence textSequence = sbn.getNotification().extras.getCharSequence("android.text");
            if (textSequence != null) {
                String text = textSequence.toString();
                long time = sbn.getPostTime();

                // Отправляем текст внутри нашего приложения
                Intent intent = new Intent("com.zenlocal.app.NEW_BANK_PUSH");
                intent.putExtra("text", text);
                intent.putExtra("time", time);
                LocalBroadcastManager.getInstance(this).sendBroadcast(intent);
            }
        }
    }
}