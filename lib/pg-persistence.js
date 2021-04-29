// const { Client } = require("pg");
const { dbQuery } = require('./db-query');
const bcrypt = require("bcrypt");

module.exports = class PgPersistence {
  constructor(session) {
    this.username = session.username;
  }

  isDoneTodoList(todoList) {
    return todoList.todos.length > 0 && todoList.todos.every(todo => todo.done);
  }

  // Toggle a todo between the done and not done state. Returns `true` on
  // success, `false` if the todo or todo list doesn't exist. The id arguments
  // must both be numeric.
  async toggleDoneTodo(todoListId, todoId) {
    const TOGGLE_DONE = `
      UPDATE todos
      SET done = NOT done
      WHERE todolist_id = $1 AND id = $2 AND username = $3`;

    let result = await dbQuery(TOGGLE_DONE, todoListId, todoId, this.username);
    return result.rowCount > 0;
  }

  // Returns a reference to the todo list with the indicated ID. Returns
  // `undefined`. if not found. Note that `todoListId` must be numeric.
  async _findTodoList(todoListId) {
    const FIND_LIST = `SELECT * FROM todolists WHERE id = $1 AND username = $2`;

    let result = await dbQuery(FIND_LIST, todoListId, this.username);
    return result.rows[0];
  }

  async sortedTodoLists() {
    const ALL_TODOLISTS = `
      SELECT * FROM todolists WHERE username = $1 ORDER BY lower(title) ASC`;
    // const FIND_TODOS = `
    //   SELECT * FROM todos WHERE todolist_id = $1 AND username = $2`;
    const ALL_TODOS = `SELECT * FROM todos WHERE username = $1`;

    let resultTodoLists = dbQuery(ALL_TODOLISTS, this.username);
    let resultTodos = dbQuery(ALL_TODOS, this.username);
    let resultBoth = await Promise.all([resultTodoLists, resultTodos]);

    let allTodoLists = resultBoth[0].rows;
    let allTodos = resultBoth[1].rows;
    if (!allTodoLists || !allTodos) return undefined;

    allTodoLists.forEach(todoList => {
      todoList.todos = allTodos.filter(todo => {
        return todoList.id === todo.todolist_id;
      });
    });

    return this._partitionTodoLists(allTodoLists);
  }

  _partitionTodoLists(todoLists) {
    let undone = [];
    let done = [];

    todoLists.forEach(todoList => {
      if (this.isDoneTodoList(todoList)) {
        done.push(todoList);
      } else {
        undone.push(todoList);
      }
    });

    return undone.concat(done);
  }

  async sortedTodos(todoList) {
    let todoListId = String(todoList.id);
    const SORT_TODOS = `SELECT * FROM todos 
      WHERE todolist_id = $1 AND username = $2
      ORDER BY done ASC, title`;

    let result = await dbQuery(SORT_TODOS, todoListId, this.username);
    return result.rows;
  }

  async loadTodoList(todoListId) {
    const FIND_TODOLIST = `
      SELECT * FROM todolists WHERE id = $1 AND username = $2`;
    const FIND_TODOS = `
      SELECT * FROM todos WHERE todolist_id = $1 AND username = $2`;

    let resultTodoList = dbQuery(FIND_TODOLIST, todoListId, this.username);
    let resultTodos = dbQuery(FIND_TODOS, todoListId, this.username);
    let resultBoth = await Promise.all([resultTodoList, resultTodos]);

    let todoList = resultBoth[0].rows[0];
    if (!todoList) return undefined;

    let todos = resultBoth[1].rows;
    todoList.todos = todos;

    return todoList;
  }

  async loadTodo(todoListId, todoId) {
    const FIND_TODO = `
      SELECT * FROM todos 
      WHERE todolist_id = $1 AND id = $2 AND username = $3`;

    let result = await dbQuery(FIND_TODO, todoListId, todoId, this.username);

    return result.rows[0];
  }

  hasUndoneTodos(todoList) {
    return todoList.todos.some(todo => !todo.done);
  }

  async deleteTodo(todoListId, todoId) {
    const DELETE_TODO = `
      DELETE FROM todos
      WHERE todolist_id = $1 AND id = $2 AND username = $3`;

    let result = await dbQuery(DELETE_TODO, todoListId, todoId, this.username);
    return result.rowCount > 0;

  }

  // Delete a todo list and all of its todos (handled by cascade). Returns a
  // Promise that resolves to `true` on success, false if the todo list doesn't
  // exist.
  async deleteTodoList(todoListId) {
    const DELETE_TODOLIST = `
      DELETE FROM todolists WHERE id = $1 AND username = $2`;

    let resultTodoList =
      await dbQuery(DELETE_TODOLIST, todoListId, this.username);

    return resultTodoList.rowCount > 0;

  }

  async completeAllTodos(todoListId) {
    const MARK_ALL_TODOS_AS_DONE =
      `UPDATE todos
       SET done = true
       WHERE todolist_id = $1 AND done != true AND username = $2`;

    let result =
      await dbQuery(MARK_ALL_TODOS_AS_DONE, todoListId, this.username);
    return result.rowCount > 0;
  }

  // Create a new todo with the specified title and add it to the indicated todo
  // list. Returns `true` on success, `false` on failure.
  async createTodo(todoListId, title) {
    const ADD_TODO = `
    INSERT INTO todos(todolist_id, title, username)
    VALUES ($1, $2, $3)`;

    let result = await dbQuery(ADD_TODO, todoListId, title, this.username);
    return result.rowCount > 0;
  }

  async setTodoListTitle(todoListId, title) {
    const UPDATE_TITLE = `
    UPDATE todolists SET title = $1 WHERE id = $2 AND username = $3`;

    let result = await dbQuery(UPDATE_TITLE, title, todoListId, this.username);
    return result.rowCount > 0;
  }

  async existsTodoListTitle(title) {
    const FIND_TODOLIST = `
      SELECT * FROM todolists WHERE title = $1 AND username = $2`;

    let result = await dbQuery(FIND_TODOLIST, title, this.username);
    return result.rowCount > 0;
  }

  // Create a new todo list with the specified title and add it to the list of
  // todo lists. Returns a Promise that resolves to `true` on success, `false`
  // if the todo list already exists.
  async createTodoList(title) {
    const ADD_TODOLIST = `
      INSERT INTO todolists(title, username) VALUES ($1, $2)`;
    try {
      let result = await dbQuery(ADD_TODOLIST, title, this.username);
      return result.rowCount > 0;
    } catch (error) {
      if (this.isUniqueConstraintViolation(error)) return false;
      throw error;
    }
  }

  // Returns `true` if `error` seems to indicate a `UNIQUE` constraint
  // violation, `false` otherwise.
  isUniqueConstraintViolation(error) {
    return /duplicate key value violates unique constraint/.test(String(error));
  }


  // Returns a Promise that resolves to `true` if `username` and `password`
  // combine to identify a legitimate application user, `false` if either the
  // `username` or `password` is invalid.
  async authenticate(username, password) {
    const FIND_HASHED_PASSWORD = `
      SELECT password FROM users WHERE username = $1`;

    let result = await dbQuery(FIND_HASHED_PASSWORD, username);
    if (result.rowCount === 0) return false;

    return bcrypt.compare(password, result.rows[0].password);
  }
};