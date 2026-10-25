package com.zenlocal.app;

import android.app.Notification;
import android.content.Intent;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

public class BankNotificationListener extends NotificationListenerService {
    private static final String TAG = "ZenBankListener";

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        String packageName = sbn.getPackageName();
        
        // Логируем все входящие пакеты (полезно для отладки)
        if ("ua.privatbank.ap24".equals(packageName)) {
            Log.i(TAG, "Поймано уведомление от Приват24!");

            Notification notification = sbn.getNotification();
            Bundle extras = notification.extras;
            
            CharSequence textSeq = null;
            if (extras != null) {
                // Пробуем разные варианты извлечения текста в зависимости от типа пуша
                textSeq = extras.getCharSequence(Notification.EXTRA_TEXT);
                if (textSeq == null) {
                    textSeq = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
                }
                if (textSeq == null) {
                    textSeq = extras.getCharSequence(Notification.EXTRA_TITLE);
                }
            }

            // Если все еще нет, берем то, что возвращал старый метод
            if (textSeq == null && extras.getCharSequence("android.text") != null) {
                textSeq = extras.getCharSequence("android.text");
            }

            if (textSeq != null) {
                String text = textSeq.toString();
                long time = sbn.getPostTime();
                Log.i(TAG, "Текст уведомления: " + text);

                Intent intent = new Intent("com.zenlocal.app.NEW_BANK_PUSH");
                intent.setPackage(getPackageName());
                intent.putExtra("text", text);
                intent.putExtra("time", time);
                sendBroadcast(intent);
            } else {
                Log.w(TAG, "Не удалось извлечь текст из extras уведомления Приват24");
            }
        }
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        // Обязательный метод
    }
}