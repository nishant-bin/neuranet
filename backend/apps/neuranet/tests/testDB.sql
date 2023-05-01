insert into users (id,name,pwph,org,suborg,totpsec,role,approved,verified,domain,registerdate,lastlogin,lastip,loginsandips_json) values ('thecompany@tekmonks.com','Tekmonks Corp','$2a$12$E17nq5jmSEVq5ukJYjRLieobm2TTyMbw.dvu0i6IgYyVd6sbByi6i','Tekmonks','Tekmonks','STAHFNIE5IQ3F7LIYDRVMAHFAQASB2RJ','admin',1,1,'tekmonks.co.uk',1682067708,'','','[]');
insert into users (id,name,pwph,org,suborg,totpsec,role,approved,verified,domain,registerdate,lastlogin,lastip,loginsandips_json) values ('kaka@tekmonks.co.uk','Kaka Hathrasi','$2a$12$E17nq5jmSEVq5ukJYjRLieobm2TTyMbw.dvu0i6IgYyVd6sbByi6i','Tekmonks','Tekmonks Corp','STAHFNIE5IQ3F7LIYDRVMAHFAQASB2RJ','user',1,1,'tekmonks.co.uk',1682067708,'','','[]');

insert into orgs (name,primary_contact_name,primary_contact_email,address,domain) values ('Tekmonks,'Tekmonks Corp','thecompany@tekmonks.com','1234 Bay St.','tekmonks.com');

insert into domains (domain,org) values ('tekmonks.co.uk','Tekmonks');
insert into domains (domain,org) values ('tekmonks.com','Tekmonks');

insert into suborgs (name, org) values ('Tekmonks Corp', 'Tekmonks');
insert into suborgs (name, org) values ('Tekmonks', 'Tekmonks');