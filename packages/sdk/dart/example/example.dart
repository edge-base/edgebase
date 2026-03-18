// EdgeBase Dart SDK — basic usage example.
//
// See https://github.com/edge-base/edgebase for documentation.

// ignore_for_file: unused_local_variable, avoid_print
import 'package:edgebase/edgebase.dart';

Future<void> main() async {
  // ─── Initialize ───
  final client = EdgeBase('https://my-app.edgebase.fun');

  // ─── Auth: Sign Up ───
  final result = await client.auth.signUp(SignUpOptions(
    email: 'user@example.com',
    password: 'securePassword123',
    data: {'displayName': 'John Doe'},
  ));
  print('Signed up: ${result.user.email}');

  // ─── Auth: Sign In ───
  final session = await client.auth.signIn(SignInOptions(
    email: 'user@example.com',
    password: 'securePassword123',
  ));
  print('Signed in: ${session.user.id}');

  // ─── Auth: Listen to auth state ───
  client.auth.onAuthStateChange.listen((user) {
    print('Auth state: ${user?.email ?? "signed out"}');
  });

  // ─── Collection: CRUD ───
  // Insert
  final post = await client.db('shared').table('posts').insert({
    'title': 'Hello EdgeBase',
    'content': 'First post from Dart SDK!',
    'status': 'published',
  });
  print('Created post: ${post['id']}');

  // Read with query builder (immutable)
  final posts = await client
      .table('posts')
      .where('status', '==', 'published')
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();
  print('Found ${posts.total ?? 0} posts');

  // Update
  await client.db('shared').table('posts').doc(post['id'] as String).update({
    'title': 'Updated title',
  });

  // Delete
  await client.db('shared').table('posts').doc(post['id'] as String).delete();

  // ─── Context ───
  // setContext removed (#133 §2) - use explicit db(namespace, id?)

  // ─── Storage ───
  // final bytes = Uint8List.fromList([0, 1, 2, 3]);
  // await client.storage.bucket('avatars').upload('user.png', bytes);
  // final url = client.storage.bucket('avatars').getUrl('user.png');

  // ─── Cleanup ───
  client.destroy();
}
