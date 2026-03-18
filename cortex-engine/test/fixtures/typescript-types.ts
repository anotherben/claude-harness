type UserId = string;

type Config = {
  host: string;
  port: number;
};

interface UserService {
  getUser(id: string): Promise<User>;
  createUser(data: CreateUserInput): Promise<User>;
  name: string;
}

interface Logger {
  info(msg: string): void;
  error(msg: string, err?: Error): void;
}

enum Status {
  Active,
  Inactive,
  Pending,
}

enum Color {
  Red = 'red',
  Green = 'green',
  Blue = 'blue',
}

function createService(config: Config): UserService {
  function buildUrl(path: string): string {
    return `${config.host}:${config.port}${path}`;
  }

  return {
    getUser: async (id) => fetch(buildUrl(`/users/${id}`)),
    createUser: async (data) => fetch(buildUrl('/users'), { method: 'POST' }),
    name: 'user-service',
  };
}
