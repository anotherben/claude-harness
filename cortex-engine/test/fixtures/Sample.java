package com.example;

import java.util.List;
import java.util.Map;

/**
 * Sample Java file for parser tests.
 */
public class Animal {
    private String name;
    private int age;

    public Animal(String name, int age) {
        this.name = name;
        this.age = age;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}

public interface Runnable {
    void run();
    int getStatus();
}

enum Color {
    RED,
    GREEN,
    BLUE
}

@interface MyAnnotation {
    String value();
    int priority() default 0;
}
