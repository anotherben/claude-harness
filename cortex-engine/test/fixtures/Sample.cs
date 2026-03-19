using System;
using System.Collections.Generic;

namespace MyApp.Core {
    public class Animal {
        private string name;
        private int age;

        public string Name { get; set; }

        public Animal(string name, int age) {
            this.name = name;
            this.age = age;
        }

        public string GetName() {
            return name;
        }

        public void SetName(string name) {
            this.name = name;
        }
    }

    public interface IRunnable {
        void Run();
        int GetStatus();
    }

    public enum Color {
        Red,
        Green,
        Blue
    }

    public struct Point {
        public int X;
        public int Y;

        public double Distance() {
            return Math.Sqrt(X * X + Y * Y);
        }
    }
}
