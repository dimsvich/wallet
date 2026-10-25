package com.zenlocal.app;

import android.content.Intent;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

public class BankNotificationListener extends NotificationListenerService {
    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        String packageName = sbn.getPackageName();
        
        if ("ua.privatbank.ap24".equals(packageName)) {
            CharSequence textSequence = sbn.getNotification().extras.getCharSequence("android.text");
            if (textSequence != null) {
                String text = textSequence.toString();
                long time = sbn.getPostTime();

                Intent intent = new Intent("com.zenlocal.app.NEW_BANK_PUSH");
                intent.setPackage(getPackageName()); // Защита: отправляем только внутрь своего приложения
                intent.putExtra("text", text);
                intent.putExtra("time", time);
                sendBroadcast(intent);
            }
        }
    }
}