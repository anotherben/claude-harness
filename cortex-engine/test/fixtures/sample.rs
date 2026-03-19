use std::collections::HashMap;
use std::fmt;

const MAX_SIZE: usize = 100;

static GLOBAL_NAME: &str = "cortex";

type Point = (f64, f64);

struct Animal {
    name: String,
    age: u32,
}

impl Animal {
    fn new(name: String) -> Self {
        Animal { name, age: 0 }
    }

    fn speak(&self) -> &str {
        "sound"
    }

    pub fn set_name(&mut self, name: String) {
        self.name = name;
    }
}

enum Color {
    Red,
    Green,
    Blue(u8, u8, u8),
}

trait Drawable {
    fn draw(&self);
    fn area(&self) -> f64;
}

impl fmt::Display for Animal {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.name)
    }
}

fn standalone_function(x: i32) -> bool {
    x > 0
}

macro_rules! say_hello {
    () => {
        println!("hello");
    };
}
