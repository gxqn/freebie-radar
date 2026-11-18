import unittest,importlib.util,pathlib,datetime,json
class SnapshotTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  spec=importlib.util.spec_from_file_location('radar_snapshot',pathlib.Path(__file__).with_name('snapshot.py'));cls.m=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.m)
 def test_only_allowlisted_public_fields_survive(self):
  item=self.m.public_item({'id':1,'title':'Useful','url':'https://example.com','status':'active','starred':True,'read':True,'read_at':'private','raw':{'apiKey':'secret'},'sessionSecret':'secret','ai':{'keep':True,'api_key':'secret'},'tags':['x']})
  self.assertFalse(item['starred']);self.assertFalse(item['read']);self.assertIsNone(item['read_at']);self.assertNotIn('secret',json.dumps(item));self.assertTrue(item['ai']['keep'])
 def test_export_is_anonymous_and_does_not_expose_source_config(self):
  def get(path):
   if path.startswith('/api/items'):return {'total':1,'items':[{'id':1,'title':'Useful','url':'https://example.com','status':'active'}]}
   if path=='/api/sources':return {'sources':[{'id':'safe','name':'Source','enabled':True,'config':{'cookie':'secret'},'last_error':'secret'}]}
   if path=='/api/site/bootstrap':return {'user':{'id':1,'rssToken':'secret'},'isAdmin':True,'onboarding':{'enabled':False}}
   if path=='/api/stats':return {'features':{'ai':False,'push':False}}
   return {}
  s=self.m.export_snapshot(get_json=get,release='r1')
  self.assertEqual(s['schema'],1);self.assertEqual(len(s['items']),1);self.assertNotIn('secret',json.dumps(s));self.assertIsNone(s['bootstrap']['user']);self.assertFalse(s['bootstrap']['isAdmin']);self.assertEqual(s['bootstrap']['siteMode'],'public')
 def test_bad_origin_or_publisher_config_rejected(self):
  with self.assertRaises(ValueError):self.m.publish_snapshot({},url='http://example.com',secret='x')
if __name__=='__main__':unittest.main()
